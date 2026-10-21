<script setup lang="ts">
import type { Step } from '@/lib/turns'
import { ChevronsUpDownIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import ThinkingStep from './ThinkingStep.vue'
import ToolStep from './ToolStep.vue'

const props = defineProps<{ steps: Step[] }>()

// Long runs of tool calls collapse to their latest steps so the newest
// activity stays in view; earlier steps are one tap away.
const VISIBLE_TAIL = 2
const COLLAPSE_AFTER = 3

const expanded = ref(false)
const collapsible = computed(() => props.steps.length > COLLAPSE_AFTER)
const hiddenCount = computed(() => props.steps.length - VISIBLE_TAIL)
const visible = computed(() =>
  collapsible.value && !expanded.value ? props.steps.slice(-VISIBLE_TAIL) : props.steps,
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <button
      v-if="collapsible"
      type="button"
      class="flex min-h-9 items-center gap-2 self-start rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
      @click="expanded = !expanded"
    >
      <ChevronsUpDownIcon class="size-3.5" />
      {{ expanded ? '收起步骤' : `展开前 ${hiddenCount} 个步骤` }}
    </button>
    <template v-for="step in visible" :key="step.id">
      <ToolStep v-if="step.type === 'tool'" :step="step" />
      <ThinkingStep v-else :text="step.text" />
    </template>
  </div>
</template>
