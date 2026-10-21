<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Collapsible } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useVModel } from '@vueuse/core'
import { computed, provide, ref, watch } from 'vue'
import { ReasoningKey } from './context'

interface Props {
  class?: HTMLAttributes['class']
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  duration?: number
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false,
  defaultOpen: false,
  duration: undefined,
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:duration', value: number): void
}>()

const isOpen = useVModel(props, 'open', emit, {
  defaultValue: props.defaultOpen,
  passive: true,
})

const internalDuration = ref<number | undefined>(props.duration)

watch(() => props.duration, (newVal) => {
  internalDuration.value = newVal
})

function updateDuration(val: number) {
  internalDuration.value = val
  emit('update:duration', val)
}

const startTime = ref<number | null>(null)

const MS_IN_S = 1000

// Track duration when streaming starts and ends
watch(() => props.isStreaming, (streaming) => {
  if (streaming) {
    // Auto-open when streaming starts
    isOpen.value = true

    if (startTime.value === null && props.duration === undefined) {
      startTime.value = Date.now()
    }
  }
  else if (startTime.value !== null) {
    const calculatedDuration = Math.ceil((Date.now() - startTime.value) / MS_IN_S)
    updateDuration(calculatedDuration)
    startTime.value = null
  }
}, { immediate: true })

provide(ReasoningKey, {
  isStreaming: computed(() => props.isStreaming),
  isOpen,
  setIsOpen: (val: boolean) => { isOpen.value = val },
  duration: computed(() => internalDuration.value),
})
</script>

<template>
  <Collapsible
    v-model:open="isOpen"
    :class="cn('not-prose mb-4', props.class)"
  >
    <slot />
  </Collapsible>
</template>
