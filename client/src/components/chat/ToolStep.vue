<script setup lang="ts">
import type { ToolStep } from '@/lib/turns'
import { ChevronRightIcon, CircleXIcon, LoaderCircleIcon } from '@lucide/vue'
import { Tool, ToolContent } from '@/components/ai-elements/tool'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { useChat } from '@/composables/useChat'
import { usePrefs } from '@/composables/usePrefs'
import { toolIcon, toolSummary, truncate } from '@/lib/tool-meta'
import { computed } from 'vue'
import ToolInputView from './ToolInputView.vue'

const props = defineProps<{ step: ToolStep }>()

const { cwd } = useChat()
const prefs = usePrefs()

const icon = computed(() => toolIcon(props.step.toolName))
const summary = computed(() => toolSummary(props.step.toolName, props.step.input, cwd.value))

const output = computed(() => truncate(props.step.output, 4000))
</script>

<template>
  <Tool :default-open="prefs.expandTools" class="mb-0 rounded-lg border-border/70 bg-card">
    <CollapsibleTrigger class="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left">
      <component :is="icon" class="size-4 shrink-0 text-muted-foreground" />
      <span class="shrink-0 text-sm font-medium">{{ step.toolName }}</span>
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{{ summary }}</span>
      <LoaderCircleIcon v-if="step.status === 'running'" class="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="运行中" />
      <CircleXIcon v-else-if="step.status === 'error'" class="size-4 shrink-0 text-destructive" aria-label="失败" />
      <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
    </CollapsibleTrigger>
    <div v-if="step.images?.length" class="flex flex-wrap gap-2 px-3 pb-2.5">
      <a v-for="img in step.images" :key="img.url" :href="img.url" target="_blank" rel="noopener">
        <img :src="img.url" alt="工具返回的图片" loading="lazy" class="max-h-80 w-auto max-w-full rounded-md border object-contain">
      </a>
    </div>
    <ToolContent class="space-y-2 border-t px-3 py-2.5">
      <ToolInputView :tool-name="step.toolName" :input="step.input" />
      <template v-if="output">
        <div class="text-xs font-medium" :class="step.status === 'error' ? 'text-destructive' : 'text-muted-foreground'">
          {{ step.status === 'error' ? '错误' : '输出' }}
        </div>
        <pre
          class="max-h-60 overflow-auto rounded-md p-2.5 font-mono text-xs whitespace-pre-wrap break-words"
          :class="step.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted/60 text-foreground/80'"
        >{{ output }}</pre>
      </template>
    </ToolContent>
  </Tool>
</template>
