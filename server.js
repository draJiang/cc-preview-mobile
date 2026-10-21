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

function textFromBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('\n');
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
        console.error('保存图片失败：', err.message);
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
      if (err) console.error(`保存 session ${this.id} 失败：`, err.message);
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
        } else if (message.subtype === 'permission_denied') {
          this.emit({
            kind: 'system_note',
            text: `权限被拒绝：${message.tool_name} — ${message.message}`,
          });
        }
        break;
      }
      case 'assistant': {
        const blocks = message.message?.content;
        if (!Array.isArray(blocks)) break;
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            this.emit({ kind: 'assistant_text', text: block.text });
          } else if (block.type === 'thinking' && block.thinking) {
            this.emit({ kind: 'thinking', text: block.thinking });
          } else if (block.type === 'tool_use') {
            this.emit({
              kind: 'tool_use',
              toolUseId: block.id,
              toolName: block.name,
              input: block.input,
            });
          }
        }
        break;
      }
      case 'user': {
        const blocks = message.message?.content;
        if (!Array.isArray(blocks)) break;
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const item = {
              kind: 'tool_result',
              toolUseId: block.tool_use_id,
              content: textFromBlocks(block.content),
              isError: !!block.is_error,
            };
            const images = extractImages(block.content, this.id);
            if (images.length) item.images = images;
            this.emit(item);
          }
        }
        break;
      }
      case 'result': {
        this.emit({
          kind: 'result',
          isError: !!message.is_error,
          resultText: message.subtype === 'success' ? message.result : message.subtype,
          costUsd: message.total_cost_usd,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
        });
        break;
      }
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
        this.emit({ kind: 'system_note', text: `权限请求超时，已自动拒绝：${toolName}` });
        resolve({ behavior: 'deny', message: 'Timed out waiting for approval from mobile client.' });
      }, PERMISSION_TIMEOUT_MS);

      this.pendingPermissions.set(requestId, { resolve, timeoutHandle, suggestions: opts.suggestions, toolName, input });

      this.emit({
        kind: 'permission_request',
        requestId,
        toolName,
        input,
        title: opts.title || `Claude 想要使用 ${toolName}`,
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
        this.emit({ kind: 'system_note', text: '澄清问题超时，已自动跳过。' });
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
      pending.resolve({ behavior: 'deny', message: '用户在手机上跳过了这个问题。' });
    } else {
      pending.resolve({
        behavior: 'allow',
        updatedInput: { questions: pending.input?.questions || [], answers: answers || {} },
      });
    }
  }

  // Approving ExitPlanMode is supposed to leave plan mode, but the SDK
  // doesn't do that automatically — the host has to flip the mode itself
  // (see anthropics/claude-code#15755). Without this, the "允许" button
  // resolves the tool call but the session stays in `plan`, so every
  // following action still needs manual approval.
  //
  // Returns whether the mode actually took effect, so callers (like the
  // ExitPlanMode fallback below) can react to a rejection instead of
  // reporting a mode that was never really applied.
  async changeMode(mode) {
    if (!this.activeQuery?.setPermissionMode) {
      this.emit({ kind: 'system_note', text: `权限模式切换失败（会话尚未就绪）：${mode}` });
      return false;
    }
    try {
      await this.activeQuery.setPermissionMode(mode);
      this.permissionMode = mode;
      this.emit({ kind: 'system_note', text: `权限模式已切换为：${mode}` });
      this.emit({ kind: 'mode_changed', mode });
      return true;
    } catch (err) {
      // The switch didn't actually take — tell the user, and re-sync every
      // client's mode selector back to whatever is really still active
      // instead of leaving it showing the mode that failed to apply.
      this.emit({ kind: 'system_note', text: `切换到 ${mode} 模式失败：${err?.message || err}` });
      this.emit({ kind: 'mode_changed', mode: this.permissionMode });
      return false;
    }
  }

  async changeModel(model) {
    if (!this.activeQuery?.setModel) {
      this.emit({ kind: 'system_note', text: `模型切换失败（会话尚未就绪）：${model}` });
      return;
    }
    // 'default' is the picker's "use the recommended model" row; the SDK
    // expresses that as setModel(undefined).
    const next = model && model !== 'default' ? model : null;
    try {
      await this.activeQuery.setModel(next ?? undefined);
      this.model = next;
      const label = this.modelLabel(next);
      this.emit({ kind: 'system_note', text: `模型已切换为：${label}` });
      this.emit({ kind: 'model_changed', model: next || 'default', label });
    } catch (err) {
      this.emit({ kind: 'system_note', text: `切换到 ${model} 失败：${err?.message || err}` });
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
      console.error('获取模型列表失败：', err?.message || err);
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
      pending.resolve({ behavior: 'deny', message: '用户在手机上拒绝了该操作。' });
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
      this.emit({ kind: 'system_note', text: `会话出错：${err?.message || err}` });
      broadcastSessionList();
    }
  }

  sendUserMessage(text) {
    this.ensureStarted();
    this.emit({ kind: 'user_text', text });
    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content: text },
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
      console.error(`读取 session 文件 ${file} 失败：`, err.message);
    }
  }
  if (sessions.size > 0) {
    console.log(`已恢复 ${sessions.size} 个历史 session。`);
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
    console.log(`Network: http://${addr}:${PORT}   <-- 用手机在同一 WiFi 下打开这个`);
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
      currentSession()?.sendUserMessage(msg.text.trim());
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
        ws.send(JSON.stringify({ type: 'usage_error', message: '当前 SDK 版本不支持获取用量信息' }));
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
      console.error(`退出前保存 session ${session.id} 失败：`, err.message);
    }
  }
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);
