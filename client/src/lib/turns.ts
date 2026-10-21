import type { Answer, ChatItem, ImageRef, Question } from './protocol'

export interface ToolStep {
  type: 'tool'
  id: string
  toolName: string
  input: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  output?: string
  images?: ImageRef[]
}

export interface ThinkingStep {
  type: 'thinking'
  id: string
  text: string
}

export type Step = ToolStep | ThinkingStep

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
  = | { type: 'user', id: string, text: string }
    | { type: 'assistant', id: string, text: string }
    | { type: 'steps', id: string, steps: Step[] }
    | { type: 'note', id: string, text: string }
    | { type: 'result', id: string, text: string, isError: boolean }
    | PermissionBlock
    | QuestionBlock

function resultMeta(item: Extract<ChatItem, { kind: 'result' }>) {
  const parts: string[] = []
  if (item.numTurns)
    parts.push(`${item.numTurns} 轮`)
  if (typeof item.costUsd === 'number')
    parts.push(`$${item.costUsd.toFixed(4)}`)
  if (item.durationMs)
    parts.push(`${(item.durationMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

// Turns the flat item stream into render blocks: consecutive thinking/tool
// items are grouped into one "steps" block, tool results are folded into the
// tool step they belong to, and resolution events are folded into their
// request cards.
export function buildBlocks(items: ChatItem[]): Block[] {
  const blocks: Block[] = []
  const tools = new Map<string, ToolStep>()
  const hiddenTools = new Set<string>()
  const permissions = new Map<string, PermissionBlock>()
  const questions = new Map<string, QuestionBlock>()
  let group: Extract<Block, { type: 'steps' }> | null = null

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

  items.forEach((item, i) => {
    switch (item.kind) {
      case 'user_text':
        push({ type: 'user', id: `u-${i}`, text: item.text })
        break
      case 'assistant_text':
        push({ type: 'assistant', id: `a-${i}`, text: item.text })
        break
      case 'thinking':
        pushStep({ type: 'thinking', id: `t-${i}`, text: item.text }, i)
        break
      case 'tool_use': {
        if (item.toolName === 'AskUserQuestion') {
          hiddenTools.add(item.toolUseId)
          break
        }
        const step: ToolStep = { type: 'tool', id: item.toolUseId, toolName: item.toolName, input: item.input || {}, status: 'running' }
        tools.set(item.toolUseId, step)
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
          pushStep({ type: 'tool', id: `r-${i}`, toolName: '工具结果', input: {}, status: item.isError ? 'error' : 'done', output: item.content, images: item.images }, i)
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
        push({ type: 'note', id: `n-${i}`, text: `会话已连接 · ${item.cwd.split('/').filter(Boolean).pop() || item.cwd}` })
        break
      case 'system_note':
        push({ type: 'note', id: `n-${i}`, text: item.text })
        break
      case 'result': {
        // A finished turn means any request still open in it can no longer be
        // answered (timed out, or the server restarted while it was waiting).
        for (const b of blocks) {
          if ((b.type === 'permission' || b.type === 'question') && b.pending)
            b.pending = false
        }
        const text = resultMeta(item)
        if (text)
          push({ type: 'result', id: `res-${i}`, text, isError: !!item.isError })
        break
      }
    }
  })

  return blocks
}
