import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { query } from '@anthropic-ai/claude-agent-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 4173;
const DEFAULT_PROJECT_DIR = process.env.PROJECT_DIR
  ? path.resolve(process.env.PROJECT_DIR)
  : os.homedir();
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000; // auto-deny if nobody answers in 10 min
const HISTORY_LIMIT = 1000;
const DATA_DIR = path.join(__dirname, 'data', 'sessions');
const SAVE_DEBOUNCE_MS = 400;

const MEDIA_DIR = path.join(__dirname, 'data', 'media');
const IMAGE_EXTS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Pull-based async queue used to feed user messages into query()'s streaming
// input mode. push() is called from the WebSocket handler; the SDK's query()
// consumes it as an AsyncIterable<SDKUserMessage>.
// ---------------------------------------------------------------------------
function createInputQueue() {
  const buffered = [];
  let waitingResolve = null;

  return {
    push(message) {
      if (waitingResolve) {
        const resolve = waitingResolve;
        waitingResolve = null;
        resolve({ value: message, done: false });
      } else {
        buffered.push(message);
      }
    },
    iterator: {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (buffered.length > 0) {
          return Promise.resolve({ value: buffered.shift(), done: false });
        }
        return new Promise((resolve) => {
          waitingResolve = resolve;
        });
      },
    },
  };
}

// Flattens a tool_result's content to text. Besides plain text blocks this
// covers the non-text blocks tools return: ToolSearch answers with
// tool_reference blocks, Read on a PDF with a document block, and some tools
// with search_result blocks. Images are handled separately (extractImages).
function textFromBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  const toolRefs = [];
  for (const b of content) {
    if (!b) continue;
    if (b.type === 'text' && b.text) parts.push(b.text);
    else if (b.type === 'tool_reference' && b.tool_name) toolRefs.push(b.tool_name);
    else if (b.type === 'document') parts.push(`[Document${b.title ? `: ${b.title}` : ''}${b.source?.media_type ? ` (${b.source.media_type})` : ''}]`);
    else if (b.type === 'search_result') parts.push([b.title, b.source, textFromBlocks(b.content)].filter(Boolean).join('\n'));
  }
  if (toolRefs.length) parts.unshift(`Loaded tools: ${toolRefs.join(', ')}`);
  return parts.join('\n');
}

// Server-side tool results inside an assistant message (web_search_tool_result,
// web_fetch_tool_result, mcp_tool_result, code execution…) don't share one
// shape; pull out whatever is readable.
function serverToolResultText(block) {
  const c = block.content;
  if (Array.isArray(c)) {
    const hits = c.filter((r) => r?.type === 'web_search_result');
    if (hits.length) return hits.map((r) => `${r.title || r.url}\n${r.url}`).join('\n\n');
    return textFromBlocks(c);
  }
  if (c && typeof c === 'object') {
    if (c.error_code) return `Error: ${c.error_code}`;
    if (typeof c.stdout === 'string' || typeof c.stderr === 'string') return [c.stdout, c.stderr].filter(Boolean).join('\n');
    if (c.url) return c.url;
    try {
      return JSON.stringify(c, null, 2);
    } catch {
      return '';
    }
  }
  return typeof c === 'string' ? c : '';
}

const RESULT_ERROR_LABELS = {
  error_max_turns: 'Stopped: reached the maximum number of turns',
  error_max_budget_usd: 'Stopped: reached the budget limit',
  error_max_structured_output_retries: 'Stopped: structured output retries exhausted',
  error_during_execution: 'Stopped with an error',
};

const RATE_LIMIT_LABELS = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly Opus limit',
  seven_day_sonnet: 'Weekly Sonnet limit',
  overage: 'Extra usage limit',
};

function formatResetTime(epochSeconds) {
  if (!epochSeconds) return '';
  const d = new Date(epochSeconds * 1000);
  return ` · resets ${d.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}


// Image blocks in tool results (Read on a .png, screenshot tools, MCP tools
// returning images…) are written to data/media/<sessionId>/ and referenced
// by URL, so session history stays small and doesn't carry base64 blobs.
function extractImages(content, sessionId) {
  const blocks = Array.isArray(content) ? content : content && typeof content === 'object' ? [content] : [];
  const images = [];
  for (const block of blocks) {
    if (block?.type !== 'image' || !block.source) continue;
    const { source } = block;
    if (source.type === 'url' && typeof source.url === 'string') {
      images.push({ url: source.url, mediaType: source.media_type });
    } else if (source.type === 'base64' && typeof source.data === 'string') {
      const ext = IMAGE_EXTS[source.media_type];
      if (!ext) continue;
      try {
        const buf = Buffer.from(source.data, 'base64');
        const name = `${crypto.createHash('sha1').update(buf).digest('hex')}.${ext}`;
        const dir = path.join(MEDIA_DIR, sessionId);
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, buf);
        }
        images.push({ url: `/media/${sessionId}/${name}`, mediaType: source.media_type });
      } catch (err) {
        console.error('Failed to save image:', err.message);
      }
    }
  }
  return images;
}

// ---------------------------------------------------------------------------
// One ChatSession = one persistent, streaming-input Claude Code conversation.
// Each has its own working directory, history, pending permissions and set
// of WebSocket clients currently viewing it. State is mirrored to a JSON
// file on disk so sessions survive a server restart (resumed via the SDK's
// `resume` option, which reloads the real Claude Code conversation too).
// ---------------------------------------------------------------------------
class ChatSession {
  constructor(cwd, restore) {
    this.id = restore?.id || crypto.randomUUID();
    this.cwd = cwd;
    this.title = restore?.title || path.basename(cwd) || cwd;
    this.hasCustomTitle = restore?.hasCustomTitle || false;
    this.createdAt = restore?.createdAt || Date.now();
    this.lastActivity = restore?.lastActivity || this.createdAt;
    this.sdkSessionId = restore?.sdkSessionId || null;
    this.status = 'paused'; // starting | ready | error | closed | paused
    this.history = restore?.history || [];
    this.nextItemId = (this.history[this.history.length - 1]?.id || 0) + 1;
    this.pendingPermissions = new Map();
    this.viewers = new Set(); // ws sockets currently looking at this session
    this.inputQueue = createInputQueue();
    this.activeQuery = null;
    this.started = false;
    this._saveTimer = null;
    this.permissionMode = 'default'; // mirrors the SDK's actual current mode, kept in sync via system_init/changeMode
    this.model = restore?.model || null; // model alias/id picked in the UI; null = SDK default. Re-applied on resume.
  }

  summary() {
    return {
      id: this.id,
      title: this.title,
      cwd: this.cwd,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      status: this.status,
    };
  }

  scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  saveNow() {
    const data = {
      id: this.id,
      cwd: this.cwd,
      title: this.title,
      hasCustomTitle: this.hasCustomTitle,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      sdkSessionId: this.sdkSessionId,
      model: this.model,
      history: this.history,
    };
    fs.writeFile(path.join(DATA_DIR, `${this.id}.json`), JSON.stringify(data), (err) => {
      if (err) console.error(`Failed to save session ${this.id}:`, err.message);
    });
  }

  deleteFile() {
    fs.rm(path.join(DATA_DIR, `${this.id}.json`), { force: true }, () => {});
    fs.rm(path.join(MEDIA_DIR, this.id), { recursive: true, force: true }, () => {});
  }

  ensureStarted() {
    if (this.started) return;
    this.started = true;
    this.status = 'starting';
    this.run();
  }

  emit(item) {
    item.id = this.nextItemId++;
    item.ts = Date.now();
    this.history.push(item);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.lastActivity = item.ts;

    if (item.kind === 'user_text' && !this.hasCustomTitle) {
      this.hasCustomTitle = true;
      this.title = item.text.slice(0, 40);
      broadcastSessionList();
    }

    const payload = JSON.stringify({ type: 'item', sessionId: this.id, item });
    for (const ws of this.viewers) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
    this.scheduleSave();
  }

  handleSdkMessage(message) {
    switch (message.type) {
      case 'system': {
        if (message.subtype === 'init') {
          this.status = 'ready';
          this.sdkSessionId = message.session_id;
          this.permissionMode = message.permissionMode || this.permissionMode;
          this.emit({
            kind: 'system_init',
            cwd: message.cwd,
            model: message.model,
            permissionMode: message.permissionMode,
            sessionId: message.session_id,
          });
          broadcastSessionList();
        } else {
          this.handleSystemMessage(message);
        }
        break;
      }
      case 'assistant': {
        const blocks = message.message?.content;
        if (!Array.isArray(blocks)) break;
        // Messages from a subagent (Agent/Task tool) carry the id of the tool
        // call that spawned them, so the client can nest them under it
        // instead of mixing them into the main conversation.
        const parent = message.parent_tool_use_id ? { parentToolUseId: message.parent_tool_use_id } : {};
        let hasText = false;
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            hasText = true;
            this.emit({ kind: 'assistant_text', text: block.text, ...parent });
          } else if (block.type === 'thinking' && block.thinking) {
            this.emit({ kind: 'thinking', text: block.thinking, ...parent });
          } else if (block.type === 'redacted_thinking') {
            this.emit({ kind: 'thinking', text: '', redacted: true, ...parent });
          } else if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use') {
            this.emit({
              kind: 'tool_use',
              toolUseId: block.id,
              toolName: block.type === 'mcp_tool_use' && block.server_name ? `mcp__${block.server_name}__${block.name}` : block.name,
              input: block.input || {},
              ...parent,
            });
          } else if (typeof block.type === 'string' && block.type.endsWith('_tool_result') && block.tool_use_id) {
            this.emit({
              kind: 'tool_result',
              toolUseId: block.tool_use_id,
              content: serverToolResultText(block),
              isError: !!block.is_error || !!block.content?.error_code,
              ...parent,
            });
          }
        }
        // API failures (auth, billing, overload…) are flagged on the message;
        // normally a text block explains them, but not always.
        if (message.error && !hasText) {
          this.emit({ kind: 'notice', level: 'error', text: `API error: ${message.error}`, ...parent });
        }
        break;
      }
      case 'user': {
        const blocks = message.message?.content;
        if (!Array.isArray(blocks)) break;
        const parent = message.parent_tool_use_id ? { parentToolUseId: message.parent_tool_use_id } : {};
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const item = {
              kind: 'tool_result',
              toolUseId: block.tool_use_id,
              content: textFromBlocks(block.content),
              isError: !!block.is_error,
              ...parent,
            };
            const images = extractImages(block.content, this.id);
            if (images.length) item.images = images;
            this.emit(item);
          }
        }
        break;
      }
      case 'result': {
        const errors = Array.isArray(message.errors) ? message.errors.filter(Boolean) : [];
        this.emit({
          kind: 'result',
          isError: !!message.is_error,
          resultText: message.subtype === 'success' ? message.result : message.subtype,
          errorText: message.subtype === 'success'
            ? (message.is_error ? message.result : undefined)
            : [RESULT_ERROR_LABELS[message.subtype] || message.subtype, ...errors].join('\n'),
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
        });
        break;
      }
      case 'rate_limit_event': {
        const info = message.rate_limit_info || {};
        // Only surface changes worth interrupting for: a new warning
        // threshold, or actually being limited.
        const key = `${info.status}:${info.rateLimitType}:${info.surpassedThreshold ?? ''}`;
        if (info.status === 'allowed' || key === this.lastRateLimitKey) break;
        this.lastRateLimitKey = key;
        const label = RATE_LIMIT_LABELS[info.rateLimitType] || 'Usage limit';
        const pct = typeof info.utilization === 'number' ? ` (${Math.round(info.utilization * (info.utilization <= 1 ? 100 : 1))}% used)` : '';
        this.emit(info.status === 'rejected'
          ? { kind: 'notice', level: 'error', text: `${label} reached${formatResetTime(info.resetsAt)}` }
          : { kind: 'notice', level: 'warning', text: `Approaching ${label.toLowerCase()}${pct}${formatResetTime(info.resetsAt)}` });
        break;
      }
      case 'conversation_reset':
        this.emit({ kind: 'notice', level: 'info', text: 'Conversation context was reset' });
        break;
      case 'auth_status':
        if (message.error) this.emit({ kind: 'notice', level: 'error', text: `Authentication error: ${message.error}` });
        break;
      default:
        // tool_progress, tool_use_summary, prompt_suggestion, stream_event…
        // carry nothing that needs to stay in the transcript.
        break;
    }
  }

  // system/* messages other than init. Ones that only matter to an
  // interactive terminal UI (hook_started, commands_changed,
  // session_state_changed…) are ignored, and so is task_progress: a
  // subagent's own messages already stream in, nested under its tool call.
  handleSystemMessage(message) {
    switch (message.subtype) {
      case 'permission_denied':
        this.emit({
          kind: 'system_note',
          text: `Permission denied: ${message.tool_name} — ${message.message}`,
        });
        break;
      case 'compact_boundary': {
        const m = message.compact_metadata || {};
        this.emit({
          kind: 'compact',
          trigger: m.trigger,
          preTokens: m.pre_tokens,
          postTokens: m.post_tokens,
        });
        break;
      }
      case 'status':
        if (message.status === 'compacting') {
          this.emit({ kind: 'notice', level: 'info', text: 'Compacting conversation…' });
        } else if (message.compact_result === 'failed') {
          this.emit({ kind: 'notice', level: 'error', text: `Compaction failed${message.compact_error ? `: ${message.compact_error}` : ''}` });
        }
        break;
      case 'api_retry': {
        const status = message.error_status ? ` ${message.error_status}` : '';
        this.emit({
          kind: 'notice',
          level: 'warning',
          text: `API error${status} (${message.error}), retrying in ${Math.round(message.retry_delay_ms / 1000)}s · attempt ${message.attempt}/${message.max_retries}`,
        });
        break;
      }
      case 'model_refusal_fallback':
      case 'model_refusal_no_fallback':
        this.emit({
          kind: 'notice',
          level: 'warning',
          text: message.content || (message.fallback_model
            ? `${message.original_model} declined; switched to ${message.fallback_model}`
            : `${message.original_model} declined to respond`),
        });
        break;
      case 'local_command_output':
        if (message.content) this.emit({ kind: 'command_output', text: message.content });
        break;
      case 'informational':
        if (message.content) {
          this.emit({ kind: 'notice', level: message.level === 'warning' ? 'warning' : 'info', text: message.content });
        }
        break;
      case 'notification':
        if (message.text) {
          this.emit({ kind: 'notice', level: message.priority === 'high' || message.priority === 'immediate' ? 'warning' : 'info', text: message.text });
        }
        break;
      case 'hook_response':
        if (message.outcome === 'error') {
          const detail = (message.stderr || message.output || '').trim();
          this.emit({ kind: 'notice', level: 'error', text: `Hook ${message.hook_name} failed${detail ? `: ${detail}` : ''}` });
        }
        break;
      case 'task_started':
        // Foreground subagents already show up as their Agent tool call.
        if (message.is_backgrounded && !message.tool_use_id && !message.skip_transcript && !message.ambient) {
          this.emit({ kind: 'notice', level: 'info', text: `Background task started: ${message.description}` });
        }
        break;
      case 'task_notification':
        if (!message.skip_transcript && !message.ambient) {
          this.emit({
            kind: 'task_notification',
            toolUseId: message.tool_use_id,
            status: message.status,
            summary: message.summary,
          });
        }
        break;
      case 'memory_recall':
        if (message.memories?.length) {
          this.emit({ kind: 'notice', level: 'info', text: `Recalled ${message.memories.length} ${message.memories.length === 1 ? 'memory' : 'memories'}: ${message.memories.map((m) => path.basename(m.path)).join(', ')}` });
        }
        break;
      case 'mirror_error':
        this.emit({ kind: 'notice', level: 'error', text: `Transcript sync error: ${message.error}` });
        break;
      default:
        break;
    }
  }

  async canUseTool(toolName, input, opts) {
    if (toolName === 'AskUserQuestion') {
      // Per the SDK docs (Handle approvals and user input), AskUserQuestion
      // goes through this same canUseTool callback — it is not a special
      // terminal-only surface. Claude expects the answer back as
      // `{ behavior: 'allow', updatedInput: { questions, answers } }`, so we
      // render it as a real multiple-choice card instead of auto-denying it.
      return this.askUserQuestion(input, opts);
    }
    return new Promise((resolve) => {
      const requestId = opts.requestId;
      const timeoutHandle = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        this.emit({ kind: 'system_note', text: `Permission request timed out, auto-denied: ${toolName}` });
        resolve({ behavior: 'deny', message: 'Timed out waiting for approval from mobile client.' });
      }, PERMISSION_TIMEOUT_MS);

      this.pendingPermissions.set(requestId, { resolve, timeoutHandle, suggestions: opts.suggestions, toolName, input });

      this.emit({
        kind: 'permission_request',
        requestId,
        toolName,
        input,
        title: opts.title || `Claude wants to use ${toolName}`,
        description: opts.description,
        displayName: opts.displayName || toolName,
      });
    });
  }

  askUserQuestion(input, opts) {
    return new Promise((resolve) => {
      const requestId = opts.requestId;
      const timeoutHandle = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        this.emit({ kind: 'system_note', text: 'Question timed out, skipped automatically.' });
        resolve({ behavior: 'deny', message: 'Timed out waiting for the user to answer on the mobile client.' });
      }, PERMISSION_TIMEOUT_MS);

      this.pendingPermissions.set(requestId, { resolve, timeoutHandle, toolName: 'AskUserQuestion', input });

      this.emit({
        kind: 'ask_user_question',
        requestId,
        questions: Array.isArray(input?.questions) ? input.questions : [],
      });
    });
  }

  resolveAskUserQuestion(requestId, answers, cancel) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutHandle);
    this.pendingPermissions.delete(requestId);

    this.emit({ kind: 'ask_user_question_resolved', requestId, answers, cancelled: !!cancel });

    if (cancel) {
      pending.resolve({ behavior: 'deny', message: 'The user skipped this question on their phone.' });
    } else {
      pending.resolve({
        behavior: 'allow',
        updatedInput: { questions: pending.input?.questions || [], answers: answers || {} },
      });
    }
  }

  // Approving ExitPlanMode is supposed to leave plan mode, but the SDK
  // doesn't do that automatically — the host has to flip the mode itself
  // (see anthropics/claude-code#15755). Without this, the "Allow" button
  // resolves the tool call but the session stays in `plan`, so every
  // following action still needs manual approval.
  //
  // Returns whether the mode actually took effect, so callers (like the
  // ExitPlanMode fallback below) can react to a rejection instead of
  // reporting a mode that was never really applied.
  async changeMode(mode) {
    if (!this.activeQuery?.setPermissionMode) {
      this.emit({ kind: 'system_note', text: `Failed to switch permission mode (session not ready): ${mode}` });
      return false;
    }
    try {
      await this.activeQuery.setPermissionMode(mode);
      this.permissionMode = mode;
      this.emit({ kind: 'system_note', text: `Permission mode changed to: ${mode}` });
      this.emit({ kind: 'mode_changed', mode });
      return true;
    } catch (err) {
      // The switch didn't actually take — tell the user, and re-sync every
      // client's mode selector back to whatever is really still active
      // instead of leaving it showing the mode that failed to apply.
      this.emit({ kind: 'system_note', text: `Failed to switch to ${mode} mode: ${err?.message || err}` });
      this.emit({ kind: 'mode_changed', mode: this.permissionMode });
      return false;
    }
  }

  async changeModel(model) {
    if (!this.activeQuery?.setModel) {
      this.emit({ kind: 'system_note', text: `Failed to switch model (session not ready): ${model}` });
      return;
    }
    // 'default' is the picker's "use the recommended model" row; the SDK
    // expresses that as setModel(undefined).
    const next = model && model !== 'default' ? model : null;
    try {
      await this.activeQuery.setModel(next ?? undefined);
      this.model = next;
      const label = this.modelLabel(next);
      this.emit({ kind: 'system_note', text: `Model changed to: ${label}` });
      this.emit({ kind: 'model_changed', model: next || 'default', label });
    } catch (err) {
      this.emit({ kind: 'system_note', text: `Failed to switch to ${model}: ${err?.message || err}` });
      this.emit({ kind: 'model_changed', model: this.model || 'default', label: this.modelLabel(this.model) });
    }
  }

  modelLabel(model) {
    const key = model || 'default';
    return cachedModels.find((m) => m.value === key)?.displayName || key;
  }

  async loadModels() {
    try {
      const models = await this.activeQuery.supportedModels();
      if (Array.isArray(models) && models.length) {
        cachedModels = models;
        broadcastModels();
      }
    } catch (err) {
      console.error('Failed to fetch model list:', err?.message || err);
    }
  }

  async resolvePermission(requestId, approve, alwaysAllow) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutHandle);
    this.pendingPermissions.delete(requestId);

    this.emit({ kind: 'permission_resolved', requestId, approved: approve });

    if (approve) {
      if (pending.toolName === 'ExitPlanMode') {
        // Mirror the interactive Claude Code client: approving a plan
        // switches straight into 'auto' mode (a model classifier vets each
        // tool call) when the account/plan has it enabled, and otherwise
        // falls back to auto-accepting edits so the user isn't immediately
        // dropped back into per-edit confirmations right after approving
        // the plan. Do this before resolving the tool call so the mode is
        // already in effect by the time Claude starts acting on it.
        const switchedToAuto = await this.changeMode('auto');
        if (!switchedToAuto) await this.changeMode('acceptEdits');
      }

      const result = { behavior: 'allow' };
      if (alwaysAllow && pending.suggestions?.length) {
        result.updatedPermissions = pending.suggestions;
      }
      pending.resolve(result);
    } else {
      pending.resolve({ behavior: 'deny', message: 'The user denied this action on their phone.' });
    }
  }

  async run() {
    const options = {
      cwd: this.cwd,
      permissionMode: 'default',
      canUseTool: (toolName, input, opts) => this.canUseTool(toolName, input, opts),
    };
    if (this.sdkSessionId) options.resume = this.sdkSessionId;
    if (this.model) options.model = this.model;

    this.activeQuery = query({ prompt: this.inputQueue.iterator, options });
    this.loadModels();

    try {
      for await (const message of this.activeQuery) {
        this.handleSdkMessage(message);
      }
    } catch (err) {
      this.status = 'error';
      this.emit({ kind: 'system_note', text: `Session error: ${err?.message || err}` });
      broadcastSessionList();
    }
  }

  sendUserMessage(text, quote) {
    this.ensureStarted();
    this.emit({ kind: 'user_text', text, ...(quote && { quote }) });
    // Claude sees the quote as a Markdown blockquote ahead of the reply.
    const content = quote
      ? `${quote.split('\n').map((line) => `> ${line}`).join('\n')}\n\n${text}`
      : text;
    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    });
  }

  close() {
    this.status = 'closed';
    try {
      this.activeQuery?.close?.();
    } catch {
      // ignore
    }
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.deleteFile();
  }
}

// ---------------------------------------------------------------------------
// Recent-project discovery, for the "new session" cwd picker.
//
// Source of truth is ~/.claude/projects/ — the Claude Code CLI creates one
// folder there per directory it has ever been run in (named by replacing
// path separators with '-'), each containing that project's session
// .jsonl files. That gives us a "really used Claude Code here, and when"
// signal for free, without this app having to track its own history (it
// can't anyway: ChatSession.close() deletes the session's json file, so a
// closed session's cwd doesn't stick around in data/sessions/).
//
// The folder-name encoding is lossy for directories whose own name already
// contains a dash (e.g. "cc-preview-mobile" and "-Users-x-minpg-cc-preview-
// mobile" look identical to a naive split). We resolve that by probing the
// filesystem: try grouping 1..N dash-separated words into each path
// segment and see which grouping actually exists on disk.
// ---------------------------------------------------------------------------
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_PROJECT_CANDIDATES = 20;
const MAX_DASH_MERGE = 6; // how many dash-separated words can combine into one real path segment

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function decodeClaudeProjectFolderName(folderName) {
  if (!folderName.startsWith('-')) return null;
  const parts = folderName.slice(1).split('-');

  function search(index, currentPath) {
    if (index >= parts.length) {
      return isDirectory(currentPath) ? currentPath : null;
    }
    for (let take = 1; take <= MAX_DASH_MERGE && index + take <= parts.length; take++) {
      const segment = parts.slice(index, index + take).join('-');
      if (!segment) continue;
      const candidate = `${currentPath}/${segment}`;
      if (isDirectory(candidate)) {
        const found = search(index + take, candidate);
        if (found) return found;
      }
    }
    return null;
  }

  return search(0, '');
}

function listRecentClaudeProjects() {
  let entries;
  try {
    entries = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const realPath = decodeClaudeProjectFolderName(entry.name);
    if (!realPath) continue;

    const dirPath = path.join(CLAUDE_PROJECTS_DIR, entry.name);
    let lastUsed = 0;
    try {
      for (const f of fs.readdirSync(dirPath)) {
        if (!f.endsWith('.jsonl')) continue;
        lastUsed = Math.max(lastUsed, fs.statSync(path.join(dirPath, f)).mtimeMs);
      }
    } catch {
      // ignore unreadable project folders
    }
    if (lastUsed === 0) continue; // no real session activity (e.g. an empty scratch folder)

    results.push({ cwd: realPath, lastUsed });
  }
  return results;
}

// Merges the Claude Code history above with every currently tracked
// session's cwd (so a path only used through this app, not yet reflected
// on disk, still shows up), dedupes, and returns the most recent ones.
function listProjectPathCandidates() {
  const byPath = new Map();
  for (const { cwd, lastUsed } of listRecentClaudeProjects()) {
    byPath.set(cwd, Math.max(byPath.get(cwd) || 0, lastUsed));
  }
  for (const session of sessions.values()) {
    byPath.set(session.cwd, Math.max(byPath.get(session.cwd) || 0, session.lastActivity));
  }

  return [...byPath.entries()]
    .map(([cwd, lastUsed]) => ({ cwd, label: path.basename(cwd) || cwd, lastUsed }))
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_PROJECT_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Global session registry
// ---------------------------------------------------------------------------
const sessions = new Map(); // id -> ChatSession
const allClients = new Set(); // every connected ws, for session-list broadcasts
let cachedModels = []; // supportedModels() result; account-wide, so shared across sessions

function modelsPayload(session) {
  return JSON.stringify({
    type: 'models',
    sessionId: session?.id,
    models: cachedModels,
    current: session?.model || 'default',
  });
}

function broadcastModels() {
  for (const ws of allClients) {
    if (ws.readyState === ws.OPEN) ws.send(modelsPayload(sessions.get(ws.sessionId)));
  }
}

function listSessionsSorted() {
  return [...sessions.values()]
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .map((s) => s.summary());
}

function broadcastSessionList() {
  const payload = JSON.stringify({ type: 'sessions', sessions: listSessionsSorted() });
  for (const ws of allClients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function createSession(cwd) {
  const session = new ChatSession(cwd || DEFAULT_PROJECT_DIR);
  sessions.set(session.id, session);
  session.ensureStarted();
  broadcastSessionList();
  return session;
}

function loadPersistedSessions() {
  let files = [];
  try {
    files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
      const data = JSON.parse(raw);
      const session = new ChatSession(data.cwd, data);
      sessions.set(session.id, session);
    } catch (err) {
      console.error(`Failed to read session file ${file}:`, err.message);
    }
  }
  if (sessions.size > 0) {
    console.log(`Restored ${sessions.size} past sessions.`);
  }
}

function attachToSession(ws, session) {
  if (ws.sessionId) {
    const prev = sessions.get(ws.sessionId);
    prev?.viewers.delete(ws);
  }
  ws.sessionId = session.id;
  session.viewers.add(ws);
  session.ensureStarted();
  ws.send(JSON.stringify({ type: 'history', sessionId: session.id, items: session.history }));
  ws.send(modelsPayload(session));
}

loadPersistedSessions();

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------
const app = express();
// The Vue client is built into dist/ by `npm run build` (run automatically before `npm start`).
app.use(express.static(path.join(__dirname, 'dist')));
app.use('/media', express.static(MEDIA_DIR, { immutable: true, maxAge: '1y' }));

const server = app.listen(PORT, '0.0.0.0', () => {
  const addrs = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

  console.log(`\nClaude Code mobile preview running.`);
  console.log(`Default project directory: ${DEFAULT_PROJECT_DIR}`);
  console.log(`Local:   http://localhost:${PORT}`);
  for (const addr of addrs) {
    console.log(`Network: http://${addr}:${PORT}   <-- open this on your phone (same WiFi)`);
  }
  console.log('');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  allClients.add(ws);
  ws.send(JSON.stringify({ type: 'sessions', sessions: listSessionsSorted() }));

  // Auto-attach to the most recently active session, or create the first one.
  const existing = listSessionsSorted();
  if (existing.length > 0) {
    attachToSession(ws, sessions.get(existing[0].id));
  } else {
    attachToSession(ws, createSession(DEFAULT_PROJECT_DIR));
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const currentSession = () => sessions.get(ws.sessionId);

    if (msg.type === 'user_message' && typeof msg.text === 'string' && msg.text.trim()) {
      const quote = typeof msg.quote === 'string' && msg.quote.trim() ? msg.quote.trim().slice(0, 4000) : undefined;
      currentSession()?.sendUserMessage(msg.text.trim(), quote);
    } else if (msg.type === 'permission_response') {
      currentSession()?.resolvePermission(msg.requestId, !!msg.approve, !!msg.alwaysAllow);
    } else if (msg.type === 'ask_user_question_response') {
      currentSession()?.resolveAskUserQuestion(msg.requestId, msg.answers, !!msg.cancel);
    } else if (msg.type === 'interrupt') {
      currentSession()?.activeQuery?.interrupt?.().catch(() => {});
    } else if (msg.type === 'set_permission_mode') {
      currentSession()?.changeMode(msg.mode);
    } else if (msg.type === 'set_model' && typeof msg.model === 'string') {
      currentSession()?.changeModel(msg.model);
    } else if (msg.type === 'list_sessions') {
      ws.send(JSON.stringify({ type: 'sessions', sessions: listSessionsSorted() }));
    } else if (msg.type === 'list_project_paths') {
      ws.send(JSON.stringify({ type: 'project_paths', paths: listProjectPathCandidates() }));
    } else if (msg.type === 'create_session') {
      const cwd = typeof msg.cwd === 'string' && msg.cwd.trim() ? path.resolve(msg.cwd.trim()) : DEFAULT_PROJECT_DIR;
      const session = createSession(cwd);
      attachToSession(ws, session);
    } else if (msg.type === 'switch_session') {
      const session = sessions.get(msg.sessionId);
      if (session) attachToSession(ws, session);
    } else if (msg.type === 'close_session') {
      const session = sessions.get(msg.sessionId);
      if (session) {
        const viewersToReassign = [...session.viewers];
        session.close();
        sessions.delete(session.id);
        broadcastSessionList();
        const remaining = listSessionsSorted();
        for (const viewerWs of viewersToReassign) {
          const next = remaining.length > 0 ? sessions.get(remaining[0].id) : createSession(DEFAULT_PROJECT_DIR);
          attachToSession(viewerWs, next);
        }
      }
    } else if (msg.type === 'get_usage') {
      const session = currentSession();
      const usageFn = session?.activeQuery?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof usageFn !== 'function') {
        ws.send(JSON.stringify({ type: 'usage_error', message: 'This SDK version does not support fetching usage info' }));
        return;
      }
      usageFn
        .call(session.activeQuery, { skipBehaviors: true })
        .then((data) => ws.send(JSON.stringify({ type: 'usage', data })))
        .catch((err) => ws.send(JSON.stringify({ type: 'usage_error', message: err?.message || String(err) })));
    }
  });

  ws.on('close', () => {
    allClients.delete(ws);
    const session = sessions.get(ws.sessionId);
    session?.viewers.delete(ws);
  });
});

function flushAndExit() {
  for (const session of sessions.values()) {
    if (session._saveTimer) clearTimeout(session._saveTimer);
    try {
      fs.writeFileSync(
        path.join(DATA_DIR, `${session.id}.json`),
        JSON.stringify({
          id: session.id,
          cwd: session.cwd,
          title: session.title,
          hasCustomTitle: session.hasCustomTitle,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
          sdkSessionId: session.sdkSessionId,
          model: session.model,
          history: session.history,
        }),
      );
    } catch (err) {
      console.error(`Failed to save session ${session.id} on exit:`, err.message);
    }
  }
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);
