// Minimal stand-ins for the Vercel AI SDK types that the copied ai-elements
// components reference, so the client doesn't depend on the `ai` package.
export type ToolState
  = | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied'

export interface ToolUIPart {
  type: `tool-${string}`
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
}

export interface DynamicToolUIPart extends Omit<ToolUIPart, 'type'> {
  type: 'dynamic-tool'
  toolName: string
}

export interface UIMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
}

export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error'
