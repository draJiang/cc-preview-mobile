import type { Answer, ChatItem, ModelInfo, ProjectPath, ServerMessage, SessionSummary, UsageData } from '@/lib/protocol'
import { computed, ref, shallowRef, triggerRef } from 'vue'
import { toast } from 'vue-sonner'
import { usePrefs } from './usePrefs'

// One WebSocket connection per page, shared by every component through
// module-level state (ported from the old public/app.js).

export type ConnectionState = 'connecting' | 'open' | 'closed'

const connection = ref<ConnectionState>('connecting')
const currentSessionId = ref<string | null>(null)
const items = shallowRef<ChatItem[]>([])
const sessions = ref<SessionSummary[]>([])
const models = ref<ModelInfo[]>([])
const currentModel = ref('default')
const projectPaths = ref<ProjectPath[]>([])
const permissionMode = ref('default')
const isProcessing = ref(false)
// cwd/model from the latest system_init; until it arrives (e.g. a brand-new
// session before its first message) the header falls back to the session list.
const initCwd = ref('')
const initModelLabel = ref('')
const usage = ref<{ loading: boolean, data: UsageData | null, error: string | null }>({ loading: false, data: null, error: null })

let ws: WebSocket | null = null
let started = false
// Values to roll back to if the server rejects an optimistic change without
// echoing mode_changed / model_changed (e.g. "session not ready").
let modeBeforeChange: string | null = null
let modelBeforeChange: string | null = null

function send(obj: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj))
}

// Bookkeeping that the old renderItem did as a side effect of drawing.
function applyItem(item: ChatItem, live: boolean) {
  switch (item.kind) {
    case 'user_text':
      isProcessing.value = true
      break
    case 'result':
      isProcessing.value = false
      break
    case 'system_init':
      initCwd.value = item.cwd
      initModelLabel.value = item.model
      permissionMode.value = item.permissionMode || 'default'
      break
    case 'mode_changed':
      permissionMode.value = item.mode
      modeBeforeChange = null
      break
    case 'model_changed':
      currentModel.value = item.model
      initModelLabel.value = item.label
      modelBeforeChange = null
      break
    case 'system_note':
      if (!live)
        break
      if (item.text.startsWith('Failed to switch permission mode') && modeBeforeChange !== null) {
        permissionMode.value = modeBeforeChange
        modeBeforeChange = null
      }
      if (item.text.startsWith('Failed to switch model') && modelBeforeChange !== null) {
        currentModel.value = modelBeforeChange
        modelBeforeChange = null
      }
      if (/fail|error|timed out/i.test(item.text))
        toast.error(item.text)
      break
  }
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'history':
      currentSessionId.value = msg.sessionId
      isProcessing.value = false
      initCwd.value = ''
      initModelLabel.value = ''
      permissionMode.value = 'default'
      for (const item of msg.items) applyItem(item, false)
      items.value = msg.items
      // Brand-new session: restore the last model / permission mode the user picked.
      if (!msg.items.some(i => i.kind === 'user_text')) {
        const prefs = usePrefs()
        if (prefs.lastMode && prefs.lastMode !== 'default') {
          permissionMode.value = prefs.lastMode
          send({ type: 'set_permission_mode', mode: prefs.lastMode })
        }
        if (prefs.lastModel && prefs.lastModel !== 'default') {
          currentModel.value = prefs.lastModel
          send({ type: 'set_model', model: prefs.lastModel })
        }
      }
      break
    case 'item':
      if (msg.sessionId !== currentSessionId.value)
        return
      applyItem(msg.item, true)
      items.value.push(msg.item)
      triggerRef(items)
      break
    case 'sessions':
      sessions.value = msg.sessions
      break
    case 'models':
      if (msg.sessionId !== currentSessionId.value)
        return
      models.value = msg.models || []
      currentModel.value = msg.current || 'default'
      break
    case 'project_paths':
      projectPaths.value = msg.paths || []
      break
    case 'usage':
      usage.value = { loading: false, data: msg.data, error: null }
      break
    case 'usage_error':
      usage.value = { loading: false, data: null, error: msg.message }
      break
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  // The Vite dev server only serves the client; talk to the backend directly.
  const host = import.meta.env.DEV ? `${location.hostname}:${import.meta.env.VITE_SERVER_PORT}` : location.host
  ws = new WebSocket(`${proto}://${host}/ws`)
  connection.value = 'connecting'
  ws.onopen = () => {
    connection.value = 'open'
  }
  ws.onclose = () => {
    connection.value = 'closed'
    setTimeout(connect, 1500)
  }
  ws.onmessage = (ev) => {
    handleMessage(JSON.parse(ev.data) as ServerMessage)
  }
}

const currentSession = computed(() => sessions.value.find(s => s.id === currentSessionId.value))
const cwd = computed(() => initCwd.value || currentSession.value?.cwd || '')

// A persisted explicit id (e.g. 'claude-opus-5-5') may be covered by an alias
// row ('opus'); otherwise it is shown as its own entry.
const modelOptions = computed<ModelInfo[]>(() => {
  const list = models.value.length ? [...models.value] : [{ value: 'default', displayName: 'Default model' }]
  if (!list.some(m => m.value === currentModel.value) && !list.some(m => m.resolvedModel === currentModel.value))
    list.push({ value: currentModel.value, displayName: currentModel.value })
  return list
})
const selectedModel = computed(() => {
  const value = currentModel.value
  if (models.value.some(m => m.value === value))
    return value
  return models.value.find(m => m.resolvedModel === value)?.value ?? value
})
const selectedModelLabel = computed(() => {
  const m = modelOptions.value.find(m => m.value === selectedModel.value)
  return m?.displayName || m?.value || initModelLabel.value
})

export function useChat() {
  if (!started) {
    started = true
    connect()
  }
  return {
    connection,
    currentSessionId,
    currentSession,
    items,
    sessions,
    cwd,
    modelOptions,
    selectedModel,
    selectedModelLabel,
    projectPaths,
    permissionMode,
    isProcessing,
    usage,
    sendMessage: (text: string) => send({ type: 'user_message', text }),
    interrupt: () => send({ type: 'interrupt' }),
    respondPermission: (requestId: string, approve: boolean, alwaysAllow: boolean) =>
      send({ type: 'permission_response', requestId, approve, alwaysAllow }),
    answerQuestion: (requestId: string, answers: Record<string, Answer>) =>
      send({ type: 'ask_user_question_response', requestId, answers }),
    skipQuestion: (requestId: string) =>
      send({ type: 'ask_user_question_response', requestId, cancel: true }),
    setPermissionMode: (mode: string) => {
      modeBeforeChange = permissionMode.value
      usePrefs().lastMode = mode
      permissionMode.value = mode // optimistic; the server sends mode_changed back (or the old mode on failure)
      send({ type: 'set_permission_mode', mode })
    },
    setModel: (model: string) => {
      modelBeforeChange = currentModel.value
      usePrefs().lastModel = model
      currentModel.value = model
      send({ type: 'set_model', model })
    },
    switchSession: (sessionId: string) => {
      if (sessionId !== currentSessionId.value)
        send({ type: 'switch_session', sessionId })
    },
    createSession: (cwd: string) => send({ type: 'create_session', cwd }),
    closeSession: (sessionId: string) => send({ type: 'close_session', sessionId }),
    refreshSessions: () => {
      send({ type: 'list_sessions' })
      send({ type: 'list_project_paths' })
    },
    refreshUsage: () => {
      usage.value = { ...usage.value, loading: true, error: null }
      send({ type: 'get_usage' })
    },
  }
}
