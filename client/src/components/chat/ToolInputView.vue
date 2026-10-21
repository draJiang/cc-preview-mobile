<script setup lang="ts">
import { CircleCheckIcon, CircleDotIcon, CircleIcon } from '@lucide/vue'
import { CodeBlock } from '@/components/ai-elements/code-block'
import { truncate } from '@/lib/tool-meta'
import { computed } from 'vue'
import PlanView from './PlanView.vue'

// What a tool call is about to do, rendered for humans: a shell command, a
// diff, or the file content being written; JSON only as the fallback. Shared
// by tool cards and permission requests.
const props = defineProps<{ toolName: string, input: Record<string, unknown> }>()

type Edit = { old_string?: unknown, new_string?: unknown }
interface Todo { content?: string, activeForm?: string, status?: string }

const view = computed(() => {
  const { toolName, input } = props
  if (toolName === 'ExitPlanMode' && typeof input.plan === 'string')
    return { kind: 'plan' as const, text: input.plan }

  if (toolName === 'TodoWrite' && Array.isArray(input.todos))
    return { kind: 'todos' as const, todos: input.todos as Todo[] }

  if ((toolName === 'Agent' || toolName === 'Task') && typeof input.prompt === 'string')
    return { kind: 'content' as const, text: truncate(input.prompt, 4000) }

  if (toolName === 'Bash' && typeof input.command === 'string')
    return { kind: 'command' as const, text: input.command }

  const edits: Edit[] = toolName === 'MultiEdit' && Array.isArray(input.edits)
    ? input.edits as Edit[]
    : toolName === 'Edit' ? [input as Edit] : []
  if (edits.length) {
    const lines: string[] = []
    for (const e of edits) {
      for (const l of String(e.old_string ?? '').split('\n')) lines.push(`- ${l}`)
      for (const l of String(e.new_string ?? '').split('\n')) lines.push(`+ ${l}`)
    }
    return { kind: 'diff' as const, text: truncate(lines.join('\n'), 4000) }
  }

  if (toolName === 'Write' && typeof input.content === 'string')
    return { kind: 'content' as const, text: truncate(input.content, 4000) }

  if (!Object.keys(input).length)
    return null
  let json: string
  try {
    json = JSON.stringify(input, null, 2)
  }
  catch {
    json = String(input)
  }
  return { kind: 'json' as const, text: truncate(json, 2000) }
})
</script>

<template>
  <PlanView v-if="view?.kind === 'plan'" :plan="view.text" />
  <ul v-else-if="view?.kind === 'todos'" class="space-y-1 text-sm">
    <li v-for="(todo, i) in view.todos" :key="i" class="flex items-start gap-2">
      <CircleCheckIcon v-if="todo.status === 'completed'" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <CircleDotIcon v-else-if="todo.status === 'in_progress'" class="mt-0.5 size-4 shrink-0 text-primary" />
      <CircleIcon v-else class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span :class="todo.status === 'completed' ? 'text-muted-foreground line-through' : todo.status === 'in_progress' ? 'font-medium' : ''">
        {{ todo.status === 'in_progress' ? (todo.activeForm || todo.content) : todo.content }}
      </span>
    </li>
  </ul>
  <pre
    v-else-if="view?.kind === 'command'"
    class="max-h-40 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs whitespace-pre-wrap break-all"
  ><span class="select-none text-muted-foreground">$ </span>{{ view.text }}</pre>
  <CodeBlock
    v-else-if="view?.kind === 'diff'"
    :code="view.text"
    language="diff"
    class="max-h-72 overflow-auto [&_code]:text-xs! [&_pre]:p-2.5! [&_pre]:text-xs! [&_pre]:whitespace-pre-wrap [&_pre]:break-all"
  />
  <pre
    v-else-if="view && 'text' in view"
    class="max-h-48 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground"
  >{{ view.text }}</pre>
</template>
