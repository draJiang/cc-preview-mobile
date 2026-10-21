<script setup lang="ts">
import type { Step } from '@/lib/turns'
import ThinkingStep from './ThinkingStep.vue'
import ToolStep from './ToolStep.vue'

defineProps<{ steps: Step[] }>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <template v-for="step in steps" :key="step.id">
      <ToolStep v-if="step.type === 'tool'" :step="step" />
      <ThinkingStep v-else :text="step.text" />
    </template>
  </div>
</template>
