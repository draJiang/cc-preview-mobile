<script setup lang="ts">
import type { ToolStep } from '@/lib/turns'
import { BotIcon, ChevronRightIcon, CircleXIcon, LoaderCircleIcon } from '@lucide/vue'
import { MessageResponse } from '@/components/ai-elements/message'
import { Tool, ToolContent } from '@/components/ai-elements/tool'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useChat } from '@/composables/useChat'
import { usePrefs } from '@/composables/usePrefs'
import { toolIcon, toolLabel, toolSummary, truncate } from '@/lib/tool-meta'
import { computed } from 'vue'
import StepGroup from './StepGroup.vue'
import ToolInputView from './ToolInputView.vue'

const props = defineProps<{ step: ToolStep }>()

const { cwd } = useChat()
const prefs = usePrefs()

const icon = computed(() => toolIcon(props.step.toolName))
const label = computed(() => toolLabel(props.step.toolName))
const summary = computed(() => toolSummary(props.step.toolName, props.step.input, cwd.value))

const output = computed(() => truncate(props.step.output, 4000))
// Subagent reports are Markdown written for a reader, not raw tool output.
const markdownOutput = computed(() => ['Agent', 'Task'].includes(props.step.toolName) && props.step.status === 'done')
const childCount = computed(() => props.step.children?.length ?? 0)
</script>

<template>
  <Tool :default-open="prefs.expandTools" class="mb-0 rounded-lg border-border/70 bg-card">
    <!-- Named group: tool cards nest when a subagent runs tools of its own. -->
    <CollapsibleTrigger class="group/tool flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left">
      <component :is="icon" class="size-4 shrink-0 text-muted-foreground" />
      <span class="max-w-[45%] shrink-0 truncate text-sm font-medium">{{ label }}</span>
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{{ summary }}</span>
      <span v-if="childCount" class="shrink-0 text-[11px] text-muted-foreground tabular-nums">{{ childCount }} steps</span>
      <LoaderCircleIcon v-if="step.status === 'running'" class="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Running" />
      <CircleXIcon v-else-if="step.status === 'error'" class="size-4 shrink-0 text-destructive" aria-label="Failed" />
      <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90" />
    </CollapsibleTrigger>
    <div v-if="step.images?.length" class="flex flex-wrap gap-2 px-3 pb-2.5">
      <a v-for="img in step.images" :key="img.url" :href="img.url" target="_blank" rel="noopener">
        <img :src="img.url" alt="Image returned by tool" loading="lazy" class="max-h-80 w-auto max-w-full rounded-md border object-contain">
      </a>
    </div>
    <ToolContent class="space-y-2 border-t px-3 py-2.5">
      <ToolInputView :tool-name="step.toolName" :input="step.input" />
      <Collapsible v-if="step.children?.length" :default-open="step.status === 'running'">
        <CollapsibleTrigger class="group/sub flex min-h-8 w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground">
          <BotIcon class="size-3.5" />
          <span class="flex-1">Subagent activity · {{ childCount }} steps</span>
          <ChevronRightIcon class="size-3.5 transition-transform group-data-[state=open]/sub:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent class="mt-1.5 border-l-2 pl-2.5">
          <StepGroup :steps="step.children" />
        </CollapsibleContent>
      </Collapsible>
      <template v-if="output">
        <div class="text-xs font-medium" :class="step.status === 'error' ? 'text-destructive' : 'text-muted-foreground'">
          {{ step.status === 'error' ? 'Error' : 'Output' }}
        </div>
        <div v-if="markdownOutput" class="max-h-96 overflow-auto rounded-md bg-muted/40 px-3 py-2.5">
          <MessageResponse :content="step.output" class="md-body text-sm leading-relaxed" />
        </div>
        <pre
          v-else
          class="max-h-60 overflow-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap break-words"
          :class="step.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-foreground/80'"
        >{{ output }}</pre>
      </template>
    </ToolContent>
  </Tool>
</template>
