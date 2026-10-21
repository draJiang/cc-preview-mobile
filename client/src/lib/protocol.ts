// Shapes of the WebSocket protocol spoken by server.js. Kept in one place so the
// rest of the client can rely on them.

export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options?: QuestionOption[]
}

export type Answer = string | string[]

export interface ImageRef {
  url: string
  mediaType?: string
}

export type ChatItem
  = | { kind: 'system_init', cwd: string, model: string, permissionMode?: string, sessionId?: string }
    | { kind: 'system_note', text: string }
    | { kind: 'user_text', text: string }
    | { kind: 'assistant_text', text: string }
    | { kind: 'thinking', text: string }
    | { kind: 'tool_use', toolUseId: string, toolName: string, input: Record<string, unknown> }
    | { kind: 'tool_result', toolUseId: string, content: string, isError: boolean, images?: ImageRef[] }
    | { kind: 'permission_request', requestId: string, toolName: string, input?: Record<string, unknown>, title: string, description?: string, displayName?: string }
    | { kind: 'permission_resolved', requestId: string, approved: boolean }
    | { kind: 'ask_user_question', requestId: string, questions: Question[] }
    | { kind: 'ask_user_question_resolved', requestId: string, answers?: Record<string, Answer>, cancelled: boolean }
    | { kind: 'mode_changed', mode: string }
    | { kind: 'model_changed', model: string, label: string }
    | { kind: 'result', isError?: boolean, resultText?: string, costUsd?: number, durationMs?: number, numTurns?: number }

export interface SessionSummary {
  id: string
  title: string
  cwd: string
  createdAt: number
  lastActivity: number
  status?: string
}

export interface ModelInfo {
  value: string
  displayName?: string
  description?: string
  resolvedModel?: string
}

export interface ProjectPath {
  cwd: string
  label: string
  lastUsed: number
}

export interface UsageWindow {
  utilization?: number
  resets_at?: string
}

export interface UsageData {
  rate_limits_available?: boolean
  rate_limits?: {
    five_hour?: UsageWindow
    seven_day?: UsageWindow
  }
}

export type ServerMessage
  = | { type: 'history', sessionId: string, items: ChatItem[] }
    | { type: 'item', sessionId: string, item: ChatItem }
    | { type: 'sessions', sessions: SessionSummary[] }
    | { type: 'models', sessionId?: string, models?: ModelInfo[], current?: string }
    | { type: 'project_paths', paths?: ProjectPath[] }
    | { type: 'usage', data: UsageData }
    | { type: 'usage_error', message: string }

export const PERMISSION_MODES = [
  { value: 'default', label: 'Default', description: 'Asks for confirmation before every tool use' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'File edits are auto-approved; other actions still ask' },
  { value: 'plan', label: 'Plan only', description: 'Read-only analysis and a proposed plan; no files are changed' },
  { value: 'auto', label: 'Auto', description: 'AI approves actions; requires account support' },
] as const

export function permissionModeLabel(mode: string) {
  return PERMISSION_MODES.find(m => m.value === mode)?.label ?? mode
}
