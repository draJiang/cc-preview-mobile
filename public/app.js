const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const modeSelect = document.getElementById('mode-select');
const modelSelect = document.getElementById('model-select');
const statusDot = document.getElementById('status-dot');
const headerCwd = document.getElementById('header-cwd');
const headerTitle = document.getElementById('header-title');
const headerInfoBtn = document.getElementById('header-info');
const sessionsOverlay = document.getElementById('sessions-overlay');
const sessionsList = document.getElementById('sessions-list');
const sessionsCloseBtn = document.getElementById('sessions-close-btn');
const newSessionCwd = document.getElementById('new-session-cwd');
const newSessionBtn = document.getElementById('new-session-btn');
const usageBtn = document.getElementById('usage-btn');
const usageOverlay = document.getElementById('usage-overlay');
const usageCloseBtn = document.getElementById('usage-close-btn');
const usageBody = document.getElementById('usage-body');

let ws = null;
let currentSessionId = null;
let sessionsCache = [];
const toolCards = new Map(); // toolUseId -> <pre> element for result
const permCards = new Map(); // requestId -> card element
const askCards = new Map(); // requestId -> ask_user_question card element

let isProcessing = false;
let sawSystemInit = false; // whether the current session's history/stream has emitted system_init yet
let initCwd = ''; // cwd from the latest system_init, so the header can be redrawn after a model switch
let currentModel = 'default'; // selected value in the model picker
let modelsCache = [];

function setProcessing(state) {
  isProcessing = state;
  if (state) {
    sendBtn.textContent = '■';
    sendBtn.title = '中断当前操作';
    sendBtn.classList.add('stop');
  } else {
    sendBtn.textContent = '↑';
    sendBtn.title = '发送';
    sendBtn.classList.remove('stop');
  }
}

function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function nearBottom() {
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderItem(item) {
  const wasNearBottom = nearBottom();

  if (item.kind === 'user_text') setProcessing(true);
  else if (item.kind === 'result') setProcessing(false);

  switch (item.kind) {
    case 'system_init': {
      sawSystemInit = true;
      initCwd = item.cwd;
      headerCwd.textContent = `${item.cwd}  ·  ${item.model}`;
      modeSelect.value = item.permissionMode || 'default';
      const row = el('div', 'row center');
      row.appendChild(el('div', 'note', `会话已连接 · ${item.cwd}`));
      chat.appendChild(row);
      break;
    }
    case 'system_note': {
      const row = el('div', 'row center');
      row.appendChild(el('div', 'note', item.text));
      chat.appendChild(row);
      break;
    }
    case 'user_text': {
      const row = el('div', 'row user');
      row.appendChild(el('div', 'bubble user', item.text));
      chat.appendChild(row);
      break;
    }
    case 'assistant_text': {
      const row = el('div', 'row assistant');
      row.appendChild(el('div', 'bubble assistant', item.text));
      chat.appendChild(row);
      break;
    }
    case 'thinking': {
      const row = el('div', 'row assistant');
      row.appendChild(el('div', 'thinking', item.text));
      chat.appendChild(row);
      break;
    }
    case 'tool_use': {
      const row = el('div', 'row assistant');
      const card = el('details', 'card');
      const summary = el('summary');
      summary.appendChild(el('span', 'tool-name', item.toolName));
      summary.appendChild(document.createTextNode(' 调用中…'));
      card.appendChild(summary);
      const inputPre = el('pre', null, formatInput(item.input));
      card.appendChild(inputPre);
      const resultPre = el('pre', null, '');
      resultPre.style.display = 'none';
      card.appendChild(resultPre);
      row.appendChild(card);
      chat.appendChild(row);
      toolCards.set(item.toolUseId, { card, summary, resultPre, toolName: item.toolName });
      break;
    }
    case 'tool_result': {
      const ref = toolCards.get(item.toolUseId);
      if (ref) {
        ref.summary.lastChild.textContent = item.isError ? ' 失败' : ' 完成';
        if (item.isError) ref.card.classList.add('error');
        ref.resultPre.textContent = truncate(item.content, 4000);
        ref.resultPre.style.display = 'block';
      } else {
        const row = el('div', 'row assistant');
        const card = el('div', item.isError ? 'card error' : 'card');
        card.appendChild(el('div', null, `工具结果${item.isError ? '（失败）' : ''}`));
        card.appendChild(el('pre', null, truncate(item.content, 4000)));
        row.appendChild(card);
        chat.appendChild(row);
      }
      break;
    }
    case 'permission_request': {
      const row = el('div', 'row assistant');
      const card = el('div', 'perm-card');
      card.appendChild(el('div', 'perm-title', item.title));
      if (item.description) card.appendChild(el('div', 'perm-desc', item.description));
      if (item.input && Object.keys(item.input).length) {
        card.appendChild(el('div', 'perm-input', formatInput(item.input)));
      }
      const actions = el('div', 'perm-actions');
      const label = el('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode('本次会话始终允许'));
      actions.appendChild(label);

      const denyBtn = el('button', 'perm-btn deny', '拒绝');
      const approveBtn = el('button', 'perm-btn approve', '允许');
      denyBtn.onclick = () => respondPermission(item.requestId, false, false);
      approveBtn.onclick = () => respondPermission(item.requestId, true, checkbox.checked);
      actions.appendChild(denyBtn);
      actions.appendChild(approveBtn);
      card.appendChild(actions);

      row.appendChild(card);
      chat.appendChild(row);
      permCards.set(item.requestId, card);
      break;
    }
    case 'permission_resolved': {
      const card = permCards.get(item.requestId);
      if (card) {
        card.classList.add('resolved');
        const status = el('div', 'perm-desc', item.approved ? '✓ 已允许' : '✕ 已拒绝');
        card.appendChild(status);
      }
      break;
    }
    case 'ask_user_question': {
      const row = el('div', 'row assistant');
      const card = el('div', 'aq-card');
      const answers = {}; // question text -> selected label / labels[] / free text

      for (const q of item.questions || []) {
        const qWrap = el('div', 'aq-question');
        if (q.header) qWrap.appendChild(el('div', 'aq-header', q.header));
        qWrap.appendChild(el('div', 'aq-text', q.question));

        const optionButtons = [];
        const selectedLabels = new Set();
        const otherInput = el('input', 'aq-other');
        otherInput.type = 'text';
        otherInput.placeholder = '其他，请输入…';

        const setAnswer = () => {
          if (otherInput.value.trim()) {
            answers[q.question] = otherInput.value.trim();
          } else if (selectedLabels.size) {
            answers[q.question] = q.multiSelect ? [...selectedLabels] : [...selectedLabels][0];
          } else {
            delete answers[q.question];
          }
          updateSubmitState();
        };

        for (const opt of q.options || []) {
          const btn = el('button', 'aq-option');
          btn.type = 'button';
          btn.appendChild(el('div', 'aq-option-label', opt.label));
          if (opt.description) btn.appendChild(el('div', 'aq-option-desc', opt.description));
          btn.onclick = () => {
            otherInput.value = '';
            if (q.multiSelect) {
              if (selectedLabels.has(opt.label)) {
                selectedLabels.delete(opt.label);
                btn.classList.remove('selected');
              } else {
                selectedLabels.add(opt.label);
                btn.classList.add('selected');
              }
            } else {
              selectedLabels.clear();
              optionButtons.forEach((b) => b.classList.remove('selected'));
              selectedLabels.add(opt.label);
              btn.classList.add('selected');
            }
            setAnswer();
          };
          optionButtons.push(btn);
          qWrap.appendChild(btn);
        }

        otherInput.addEventListener('input', () => {
          if (otherInput.value.trim()) {
            selectedLabels.clear();
            optionButtons.forEach((b) => b.classList.remove('selected'));
          }
          setAnswer();
        });
        qWrap.appendChild(otherInput);
        card.appendChild(qWrap);
      }

      const actions = el('div', 'aq-actions');
      const skipBtn = el('button', 'perm-btn deny', '跳过');
      const submitBtn = el('button', 'perm-btn approve', '发送回答');
      submitBtn.disabled = true;
      function updateSubmitState() {
        const questions = item.questions || [];
        submitBtn.disabled = questions.some((q) => {
          const a = answers[q.question];
          return a === undefined || a === '' || (Array.isArray(a) && a.length === 0);
        });
      }
      skipBtn.onclick = () => {
        send({ type: 'ask_user_question_response', requestId: item.requestId, cancel: true });
      };
      submitBtn.onclick = () => {
        send({ type: 'ask_user_question_response', requestId: item.requestId, answers });
      };
      actions.appendChild(skipBtn);
      actions.appendChild(submitBtn);
      card.appendChild(actions);

      row.appendChild(card);
      chat.appendChild(row);
      askCards.set(item.requestId, card);
      break;
    }
    case 'ask_user_question_resolved': {
      const card = askCards.get(item.requestId);
      if (card) {
        card.classList.add('resolved');
        const status = el('div', 'perm-desc', item.cancelled ? '✕ 已跳过' : '✓ 已回答');
        card.appendChild(status);
      }
      break;
    }
    case 'mode_changed': {
      modeSelect.value = item.mode;
      break;
    }
    case 'model_changed': {
      currentModel = item.model;
      renderModelOptions();
      if (sawSystemInit) headerCwd.textContent = `${initCwd}  ·  ${item.label}`;
      break;
    }
    case 'result': {
      const row = el('div', 'row center');
      const parts = [];
      if (item.numTurns) parts.push(`${item.numTurns} 轮`);
      if (typeof item.costUsd === 'number') parts.push(`$${item.costUsd.toFixed(4)}`);
      if (item.durationMs) parts.push(`${(item.durationMs / 1000).toFixed(1)}s`);
      row.appendChild(el('div', 'result-note', parts.join(' · ')));
      chat.appendChild(row);
      break;
    }
    default:
      break;
  }

  if (wasNearBottom) scrollToBottom();
}

function formatInput(input) {
  if (!input) return '';
  try {
    return truncate(JSON.stringify(input, null, 2), 2000);
  } catch {
    return String(input);
  }
}

function truncate(str, max) {
  if (!str) return '';
  str = String(str);
  return str.length > max ? str.slice(0, max) + '\n…（已截断）' : str;
}

function respondPermission(requestId, approve, alwaysAllow) {
  send({ type: 'permission_response', requestId, approve, alwaysAllow });
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    statusDot.className = 'status-dot connected';
  };
  ws.onclose = () => {
    statusDot.className = 'status-dot error';
    setTimeout(connect, 1500);
  };
  ws.onerror = () => {
    statusDot.className = 'status-dot error';
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'history') {
      currentSessionId = msg.sessionId;
      chat.innerHTML = '';
      sawSystemInit = false;
      headerCwd.textContent = '连接中…';
      toolCards.clear();
      permCards.clear();
      askCards.clear();
      setProcessing(false);
      for (const item of msg.items) renderItem(item);
      scrollToBottom();
      updateHeaderFromCache();
    } else if (msg.type === 'item') {
      if (msg.sessionId !== currentSessionId) return;
      renderItem(msg.item);
    } else if (msg.type === 'sessions') {
      sessionsCache = msg.sessions;
      renderSessionsList();
      updateHeaderFromCache();
    } else if (msg.type === 'models') {
      if (msg.sessionId !== currentSessionId) return;
      modelsCache = msg.models || [];
      currentModel = msg.current || 'default';
      renderModelOptions();
    } else if (msg.type === 'usage') {
      renderUsage(msg.data);
    } else if (msg.type === 'usage_error') {
      usageBody.innerHTML = '';
      usageBody.appendChild(el('div', 'usage-error', msg.message));
    }
  };
}
connect();

function updateHeaderFromCache() {
  const active = sessionsCache.find((s) => s.id === currentSessionId);
  if (!active) return;
  headerTitle.textContent = active.title;
  // The real cwd/model line only arrives once the SDK session actually starts
  // and emits system_init (e.g. after the first message on a brand-new
  // session). Until then, fall back to the cwd we already know from the
  // session list instead of leaving the nav stuck on "连接中…".
  if (!sawSystemInit) headerCwd.textContent = active.cwd;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

function renderSessionsList() {
  sessionsList.innerHTML = '';
  for (const s of sessionsCache) {
    const row = el('div', 'session-row' + (s.id === currentSessionId ? ' active' : ''));
    const main = el('button', 'session-row-main');
    main.appendChild(el('div', 'session-row-title', s.title));
    main.appendChild(el('div', 'session-row-meta', `${s.cwd} · ${relativeTime(s.lastActivity)}`));
    main.onclick = () => {
      if (s.id !== currentSessionId) send({ type: 'switch_session', sessionId: s.id });
      closeSessionsPanel();
    };
    row.appendChild(main);

    const closeBtn = el('button', 'session-row-close', '×');
    closeBtn.title = '关闭会话';
    let confirming = false;
    let revertTimer = null;
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      if (!confirming) {
        confirming = true;
        closeBtn.textContent = '确定?';
        closeBtn.classList.add('confirm');
        revertTimer = setTimeout(() => {
          confirming = false;
          closeBtn.textContent = '×';
          closeBtn.classList.remove('confirm');
        }, 3000);
      } else {
        clearTimeout(revertTimer);
        send({ type: 'close_session', sessionId: s.id });
      }
    };
    row.appendChild(closeBtn);

    sessionsList.appendChild(row);
  }
}

function renderModelOptions() {
  modelSelect.innerHTML = '';
  const models = modelsCache.length ? modelsCache : [{ value: 'default', displayName: '默认模型' }];
  for (const m of models) {
    const opt = el('option', null, m.displayName || m.value);
    opt.value = m.value;
    if (m.description) opt.title = m.description;
    modelSelect.appendChild(opt);
  }
  // A persisted explicit id (e.g. 'claude-opus-5-5') may be covered by an
  // alias row ('opus'); otherwise show it as its own entry.
  let value = currentModel;
  if (!models.some((m) => m.value === value)) {
    const alias = models.find((m) => m.resolvedModel === value);
    if (alias) value = alias.value;
    else {
      const opt = el('option', null, value);
      opt.value = value;
      modelSelect.appendChild(opt);
    }
  }
  modelSelect.value = value;
}

function openSessionsPanel() {
  send({ type: 'list_sessions' });
  sessionsOverlay.hidden = false;
}
function closeSessionsPanel() {
  sessionsOverlay.hidden = true;
  newSessionCwd.value = '';
}

headerInfoBtn.addEventListener('click', openSessionsPanel);
sessionsCloseBtn.addEventListener('click', closeSessionsPanel);
sessionsOverlay.addEventListener('click', (e) => {
  if (e.target === sessionsOverlay) closeSessionsPanel();
});
newSessionBtn.addEventListener('click', () => {
  send({ type: 'create_session', cwd: newSessionCwd.value.trim() });
  closeSessionsPanel();
});

function formatResetTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `今天 ${time} 重置`;
  const date = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  return `${date} ${time} 重置`;
}

function usageRow(label, win) {
  const row = el('div', 'usage-row');
  row.appendChild(el('div', 'usage-row-label', label));
  const used = win?.utilization;
  const hasData = typeof used === 'number';
  const pct = hasData ? Math.min(100, Math.max(0, used)) : 0;
  const bar = el('div', 'usage-bar');
  const fill = el('div', 'usage-bar-fill' + (pct >= 90 ? ' high' : ''));
  fill.style.width = pct + '%';
  bar.appendChild(fill);
  row.appendChild(bar);
  const parts = [hasData ? `剩余 ${Math.round(100 - used)}%` : '无数据'];
  if (win?.resets_at) parts.push(formatResetTime(win.resets_at));
  row.appendChild(el('div', 'usage-row-meta', parts.join(' · ')));
  return row;
}

function renderUsage(data) {
  usageBody.innerHTML = '';
  if (!data.rate_limits_available || !data.rate_limits) {
    usageBody.appendChild(el('div', 'usage-error', '当前账号没有套餐限额数据（可能按 API Key 计费）'));
    return;
  }
  usageBody.appendChild(usageRow('5 小时限额', data.rate_limits.five_hour));
  usageBody.appendChild(usageRow('每周限额', data.rate_limits.seven_day));
}

function openUsagePanel() {
  usageBody.innerHTML = '';
  usageBody.appendChild(el('div', 'usage-loading', '加载中…'));
  usageOverlay.hidden = false;
  send({ type: 'get_usage' });
}
function closeUsagePanel() {
  usageOverlay.hidden = true;
}
usageBtn.addEventListener('click', openUsagePanel);
usageCloseBtn.addEventListener('click', closeUsagePanel);
usageOverlay.addEventListener('click', (e) => {
  if (e.target === usageOverlay) closeUsagePanel();
});

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}
input.addEventListener('input', autoGrow);

function submitMessage() {
  const text = input.value.trim();
  if (!text) return;
  send({ type: 'user_message', text });
  input.value = '';
  autoGrow();
}

sendBtn.addEventListener('click', () => {
  if (isProcessing) {
    send({ type: 'interrupt' });
  } else {
    submitMessage();
  }
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitMessage();
  }
});

modelSelect.addEventListener('change', () => {
  send({ type: 'set_model', model: modelSelect.value });
});

modeSelect.addEventListener('change', () => {
  send({ type: 'set_permission_mode', mode: modeSelect.value });
});
