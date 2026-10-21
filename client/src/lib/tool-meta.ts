import type { Component } from 'vue'
import {
  BotIcon,
  ClipboardListIcon,
  FileEditIcon,
  FileIcon,
  FilePlusIcon,
  FolderSearchIcon,
  GlobeIcon,
  ListChecksIcon,
  ListTodoIcon,
  MessageCircleQuestionIcon,
  PlugIcon,
  SearchIcon,
  SparklesIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from '@lucide/vue'

// Per-tool presentation: an icon plus a one-line summary of what the call does,
// so a collapsed tool card still says "ran `npm test`" rather than just "Bash".

const ICONS: Record<string, Component> = {
  Bash: SquareTerminalIcon,
  Read: FileIcon,
  Write: FilePlusIcon,
  Edit: FileEditIcon,
  MultiEdit: FileEditIcon,
  NotebookEdit: FileEditIcon,
  Grep: SearchIcon,
  Glob: FolderSearchIcon,
  WebFetch: GlobeIcon,
  WebSearch: GlobeIcon,
  TodoWrite: ListTodoIcon,
  TaskCreate: ListChecksIcon,
  TaskUpdate: ListChecksIcon,
  TaskList: ListChecksIcon,
  TaskGet: ListChecksIcon,
  ToolSearch: WrenchIcon,
  Skill: SparklesIcon,
  Task: BotIcon,
  Agent: BotIcon,
  AskUserQuestion: MessageCircleQuestionIcon,
  ExitPlanMode: ClipboardListIcon,
}

export function toolIcon(name: string): Component {
  return ICONS[name] ?? (name.startsWith('mcp__') ? PlugIcon : WrenchIcon)
}

// MCP tools arrive as `mcp__<server>__<tool>`; show just the tool name (the
// plug icon already says it's MCP). Server ids that are UUIDs aren't useful.
export function toolLabel(name: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? m[2] : name
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

export function relativePath(file: string, cwd: string) {
  if (cwd && file.startsWith(`${cwd}/`))
    return file.slice(cwd.length + 1)
  return file
}

export function toolSummary(name: string, input: Record<string, unknown>, cwd: string): string {
  const firstLine = (s: string) => s.split('\n')[0]
  switch (name) {
    case 'Bash':
      return str(input.description) ?? firstLine(str(input.command) ?? '')
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const file = str(input.file_path) ?? str(input.notebook_path)
      return file ? relativePath(file, cwd) : ''
    }
    case 'Grep':
    case 'Glob':
      return str(input.pattern) ?? ''
    case 'WebFetch':
      return str(input.url) ?? ''
    case 'WebSearch':
      return str(input.query) ?? ''
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos as { status?: string }[] : []
      const done = todos.filter(t => t.status === 'completed').length
      return `${todos.length} tasks · ${done} done`
    }
    case 'Task':
    case 'Agent':
      return str(input.description) ?? ''
    case 'TaskCreate':
      return str(input.subject) ?? ''
    case 'TaskUpdate':
      return [str(input.status), str(input.subject) ?? `#${input.taskId}`].filter(Boolean).join(' · ')
    case 'ToolSearch':
      return str(input.query) ?? ''
    case 'Skill':
      return str(input.skill) ?? ''
    case 'AskUserQuestion':
      return 'Asking you a question'
    case 'ExitPlanMode': {
      // First Markdown heading, or the first non-empty line, as the plan title.
      const lines = (str(input.plan) ?? '').split('\n').map(l => l.trim()).filter(Boolean)
      const title = lines.find(l => l.startsWith('#')) ?? lines[0] ?? ''
      return title.replace(/^#+\s*/, '')
    }
    default: {
      const first = Object.values(input).find(v => typeof v === 'string' && v.trim())
      return first ? firstLine(first as string) : ''
    }
  }
}

export function truncate(text: string | undefined, max: number) {
  if (!text)
    return ''
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text
}
