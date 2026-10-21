<script setup lang="ts">
import { BrainIcon, ChevronRightIcon } from '@lucide/vue'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { usePrefs } from '@/composables/usePrefs'
import { computed } from 'vue'

const props = defineProps<{ text: string, redacted?: boolean }>()
const prefs = usePrefs()

const preview = computed(() => props.text.replace(/\s+/g, ' ').trim())
</script>

<template>
  <!-- Encrypted by the API; there is nothing to show beyond the fact it happened. -->
  <div v-if="redacted" class="flex min-h-9 items-center gap-2 text-sm text-muted-foreground">
    <BrainIcon class="size-4 shrink-0" />
    <span>Thinking</span>
    <span class="text-xs opacity-70">(redacted)</span>
  </div>
  <Reasoning v-else :default-open="prefs.expandThinking" class="mb-0">
    <!-- Named group: a thinking step can sit inside an open subagent tool card. -->
    <ReasoningTrigger class="group/thinking min-h-9 py-1">
      <BrainIcon class="size-4 shrink-0" />
      <span class="shrink-0">Thinking</span>
      <span class="min-w-0 flex-1 truncate text-left text-xs opacity-70 group-data-[state=open]/thinking:invisible">{{ preview }}</span>
      <ChevronRightIcon class="size-4 shrink-0 transition-transform group-data-[state=open]/thinking:rotate-90" />
    </ReasoningTrigger>
    <ReasoningContent :content="text" class="mt-1 border-l-2 pl-3 text-[13px] leading-relaxed" />
  </Reasoning>
</template>
