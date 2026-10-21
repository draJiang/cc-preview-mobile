<script setup lang="ts">
import { CodeBlock } from '@/components/ai-elements/code-block'
import { truncate } from '@/lib/tool-meta'
import { computed } from 'vue'

// What a tool call is about to do, rendered for humans: a shell command, a
// diff, or the file content being written; JSON only as the fallback. Shared
// by tool cards and permission requests.
const props = defineProps<{ toolName: string, input: Record<string, unknown> }>()

type Edit = { old_string?: unknown, new_string?: unknown }

const view = computed(() => {
  const { toolName, input } = props
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
  <pre
    v-if="view?.kind === 'command'"
    class="max-h-40 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs whitespace-pre-wrap break-all"
  ><span class="select-none text-muted-foreground">$ </span>{{ view.text }}</pre>
  <CodeBlock
    v-else-if="view?.kind === 'diff'"
    :code="view.text"
    language="diff"
    class="max-h-72 overflow-auto [&_code]:text-xs! [&_pre]:p-2.5! [&_pre]:text-xs! [&_pre]:whitespace-pre-wrap [&_pre]:break-all"
  />
  <pre
    v-else-if="view"
    class="max-h-48 overflow-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground"
  >{{ view.text }}</pre>
</template>
