<script setup lang="ts">
import type { CSSProperties, HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed, useSlots } from 'vue'

export interface TextShimmerProps {
  as?: keyof HTMLElementTagNameMap
  class?: HTMLAttributes['class']
  duration?: number
  spread?: number
}

const props = withDefaults(defineProps<TextShimmerProps>(), {
  as: 'p',
  duration: 2,
  spread: 2,
})

const slots = useSlots()

const textLength = computed(() =>
  (slots.default?.() ?? [])
    .map(vnode => (typeof vnode.children === 'string' ? vnode.children : ''))
    .join('')
    .length,
)

const style = computed((): CSSProperties => ({
  '--spread': `${textLength.value * props.spread}px`,
  'animationDuration': `${props.duration}s`,
  'backgroundImage':
    'linear-gradient(90deg,#0000 calc(50% - var(--spread)),var(--color-background),#0000 calc(50% + var(--spread))), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))',
}))
</script>

<template>
  <component
    :is="props.as"
    :class="cn('shimmer-text relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-repeat:no-repeat,padding-box]', props.class)"
    :style="style"
  >
    <slot />
  </component>
</template>

<style scoped>
.shimmer-text {
  animation-name: shimmer-sweep;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
}
@keyframes shimmer-sweep {
  from { background-position: 100% center, 0 0; }
  to { background-position: 0% center, 0 0; }
}
</style>
