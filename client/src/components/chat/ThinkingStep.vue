<script setup lang="ts">
import { BrainIcon, ChevronRightIcon } from '@lucide/vue'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { usePrefs } from '@/composables/usePrefs'
import { computed } from 'vue'

const props = defineProps<{ text: string }>()
const prefs = usePrefs()

const preview = computed(() => props.text.replace(/\s+/g, ' ').trim())
</script>

<template>
  <Reasoning :default-open="prefs.expandThinking" class="group mb-0">
    <ReasoningTrigger class="min-h-9 py-1">
      <BrainIcon class="size-4 shrink-0" />
      <span class="shrink-0">思考过程</span>
      <span class="min-w-0 flex-1 truncate text-left text-xs opacity-70 group-data-[state=open]:invisible">{{ preview }}</span>
      <ChevronRightIcon class="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
    </ReasoningTrigger>
    <ReasoningContent :content="text" class="mt-1 border-l-2 pl-3 text-[13px] leading-relaxed" />
  </Reasoning>
</template>
