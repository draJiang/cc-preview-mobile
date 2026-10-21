import type { Answer, ChatItem, ImageRef, NoticeLevel, Question } from './protocol'

export interface ToolStep {
  type: 'tool'
  id: string
  toolName: string
  input: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  output?: string
  images?: ImageRef[]
  // What a subagent spawned by this call (Agent/Task) did, in order.
  children?: Step[]
}

export interface ThinkingStep {
  type: 'thinking'
  id: string
  text: string
  redacted?: boolean
}

// A subagent's own text replies, shown inside its parent tool step.
export interface TextStep {
  type: 'text'
  id: string
  text: string
}

export type Step = ToolStep | ThinkingStep | TextStep

export interface PermissionBlock {
  type: 'permission'
  id: string
  toolName: string
  title: string
  description?: string
  input?: Record<string, unknown>
  resolution?: 'approved' | 'denied'
  pending: boolean
}

export interface QuestionBlock {
  type: 'question'
  id: string
  questions: Question[]
  resolution?: 'answered' | 'skipped'
  answers?: Record<string, Answer>
  pending: boolean
}

export type Block
  = | { type: 'user', id: string, text: string, quote?: string }
    | { type: 'assistant', id: string, text: string }
    | { type: 'steps', id: string, steps: Step[] }
    | { type: 'note', id: string, text: string }
    | { type: 'notice', id: string, level: NoticeLevel, text: string }
    | { type: 'compact', id: string, text: string }
    | { type: 'command_output', id: string, text: string }
    | { type: 'result', id: string, text: string, isError: boolean, errorText?: string }
    | PermissionBlock
    | QuestionBlock

function resultMeta(item: Extract<ChatItem, { kind: 'result' }>) {
  const parts: string[] = []
  if (item.numTurns)
    parts.push(`${item.numTurns} turns`)
  if (typeof item.costUsd === 'number')
    parts.push(`$${item.costUsd.toFixed(4)}`)
  if (item.durationMs)
    parts.push(`${(item.durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

function formatTokens(n?: number) {
  if (typeof n !== 'number')
    return '?'
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

const TASK_STATUS = {
  completed: { label: 'Background task completed', level: 'info' },
  failed: { label: 'Background task failed', level: 'error' },
  stopped: { label: 'Background task stopped', level: 'warning' },
} as const

// Turns the flat item stream into render blocks: consecutive thinking/tool
// items are grouped into one "steps" block, tool results are folded into the
// tool step they belong to, and resolution events are folded into their
// request cards. Anything a subagent produced (items carrying
// parentToolUseId) is nested under the Agent/Task step that spawned it.
export function buildBlocks(items: ChatItem[]): Block[] {
  const blocks: Block[] = []
  const tools = new Map<string, ToolStep>()
  const hiddenTools = new Set<string>()
  const permissions = new Map<string, PermissionBlock>()
  const questions = new Map<string, QuestionBlock>()
  let group: Extract<Block, { type: 'steps' }> | null = null
  let lastInitCwd: string | null = null

  const pushStep = (step: Step, index: number) => {
    if (!group) {
      group = { type: 'steps', id: `steps-${index}`, steps: [] }
      blocks.push(group)
    }
    group.steps.push(step)
  }
  const push = (block: Block) => {
    group = null
    blocks.push(block)
  }
  // The step list of the subagent that produced an item, if its parent tool
  // call is known; otherwise the item is shown at the top level.
  const childSteps = (parentId: string | undefined) => {
    const parent = parentId ? tools.get(parentId) : undefined
    if (!parent)
      return null
    return (parent.children ??= [])
  }

  items.forEach((item, i) => {
    switch (item.kind) {
      case 'user_text':
        push({ type: 'user', id: `u-${i}`, text: item.text, quote: item.quote })
        break
      case 'assistant_text': {
        const children = childSteps(item.parentToolUseId)
        if (children)
          children.push({ type: 'text', id: `a-${i}`, text: item.text })
        else
          push({ type: 'assistant', id: `a-${i}`, text: item.text })
        break
      }
      case 'thinking': {
        const step: ThinkingStep = { type: 'thinking', id: `t-${i}`, text: item.text, redacted: item.redacted }
        const children = childSteps(item.parentToolUseId)
        if (children)
          children.push(step)
        else
          pushStep(step, i)
        break
      }
      case 'tool_use': {
        if (item.toolName === 'AskUserQuestion') {
          hiddenTools.add(item.toolUseId)
          break
        }
        const step: ToolStep = { type: 'tool', id: item.toolUseId, toolName: item.toolName, input: item.input || {}, status: 'running' }
        const children = childSteps(item.parentToolUseId)
        tools.set(item.toolUseId, step)
        if (children)
          children.push(step)
        else
          pushStep(step, i)
        break
      }
      case 'tool_result': {
        if (hiddenTools.has(item.toolUseId))
          break
        const step = tools.get(item.toolUseId)
        if (step) {
          step.status = item.isError ? 'error' : 'done'
          step.output = item.content
          step.images = item.images
        }
        else {
          pushStep({ type: 'tool', id: `r-${i}`, toolName: 'Tool result', input: {}, status: item.isError ? 'error' : 'done', output: item.content, images: item.images }, i)
        }
        break
      }
      case 'permission_request': {
        const block: PermissionBlock = { type: 'permission', id: item.requestId, toolName: item.toolName, title: item.title, description: item.description, input: item.input, pending: true }
        permissions.set(item.requestId, block)
        push(block)
        break
      }
      case 'permission_resolved': {
        const block = permissions.get(item.requestId)
        if (block) {
          block.resolution = item.approved ? 'approved' : 'denied'
          block.pending = false
        }
        break
      }
      case 'ask_user_question': {
        const block: QuestionBlock = { type: 'question', id: item.requestId, questions: item.questions || [], pending: true }
        questions.set(item.requestId, block)
        push(block)
        break
      }
      case 'ask_user_question_resolved': {
        const block = questions.get(item.requestId)
        if (block) {
          block.resolution = item.cancelled ? 'skipped' : 'answered'
          block.answers = item.answers
          block.pending = false
        }
        break
      }
      case 'system_init':
        // The SDK re-sends init at the start of every turn; only the first
        // one (or a change of directory) is worth a line.
        if (item.cwd !== lastInitCwd)
          push({ type: 'note', id: `n-${i}`, text: `Session connected · ${item.cwd.split('/').filter(Boolean).pop() || item.cwd}` })
        lastInitCwd = item.cwd
        break
      case 'system_note':
        push({ type: 'note', id: `n-${i}`, text: item.text })
        break
      case 'notice':
        push({ type: 'notice', id: `nt-${i}`, level: item.level, text: item.text })
        break
      case 'compact': {
        const tokens = item.postTokens ? `${formatTokens(item.preTokens)} → ${formatTokens(item.postTokens)} tokens` : `${formatTokens(item.preTokens)} tokens`
        push({ type: 'compact', id: `c-${i}`, text: `${item.trigger === 'auto' ? 'Auto-compacted' : 'Compacted'} · ${tokens}` })
        break
      }
      case 'command_output':
        push({ type: 'command_output', id: `co-${i}`, text: item.text })
        break
      case 'task_notification': {
        const status = TASK_STATUS[item.status] ?? TASK_STATUS.completed
        const step = item.toolUseId ? tools.get(item.toolUseId) : undefined
        const what = typeof step?.input.description === 'string' ? step.input.description : ''
        if (step?.status === 'running')
          step.status = item.status === 'completed' ? 'done' : 'error'
        push({ type: 'notice', id: `tn-${i}`, level: status.level, text: item.summary || (what ? `${status.label}: ${what}` : status.label) })
        break
      }
      case 'result': {
        // A finished turn means any request still open in it can no longer be
        // answered (timed out, or the server restarted while it was waiting).
        for (const b of blocks) {
          if ((b.type === 'permission' || b.type === 'question') && b.pending)
            b.pending = false
        }
        const text = resultMeta(item)
        if (text || item.errorText)
          push({ type: 'result', id: `res-${i}`, text, isError: !!item.isError, errorText: item.isError ? item.errorText : undefined })
        break
      }
    }
  })

  return blocks
}
