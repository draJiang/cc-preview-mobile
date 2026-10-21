<script setup lang="ts">
import { QuoteIcon } from '@lucide/vue'
import { useQuote } from '@/composables/useQuote'
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Floating "Quote" chip for a text selection inside one message. It sits
// below the selection because the native copy menu on iOS/Android opens above.

const { setQuote } = useQuote()

const BUTTON_W = 76
const BUTTON_H = 32
const GUTTER = 16

const pos = ref<{ left: number, top: number } | null>(null)
let selected = ''
let timer: ReturnType<typeof setTimeout> | undefined

function hide() {
  pos.value = null
  selected = ''
}

function update() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount)
    return hide()
  const range = sel.getRangeAt(0)
  const container = range.commonAncestorContainer
  const el = container instanceof Element ? container : container.parentElement
  const text = sel.toString().trim()
  if (!text || !el?.closest('[data-quotable]'))
    return hide()

  const rect = range.getBoundingClientRect()
  const vh = window.visualViewport?.height ?? window.innerHeight
  const left = Math.min(Math.max(rect.left + rect.width / 2 - BUTTON_W / 2, GUTTER), window.innerWidth - BUTTON_W - GUTTER)
  // Keep clear of the composer: flip above the selection when there is no
  // room below (leaving space for the native menu that sits right above it).
  let top = rect.bottom + 12
  if (top + BUTTON_H > vh - 140)
    top = Math.max(rect.top - BUTTON_H - 56, GUTTER)
  selected = text
  pos.value = { left, top }
}

function onSelectionChange() {
  clearTimeout(timer)
  timer = setTimeout(update, 150)
}

function onClick() {
  if (!selected)
    return
  setQuote(selected)
  window.getSelection()?.removeAllRanges()
  hide()
}

onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange)
  // Positions are viewport-based, so re-measure when the conversation scrolls.
  window.addEventListener('scroll', onSelectionChange, true)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  document.removeEventListener('selectionchange', onSelectionChange)
  window.removeEventListener('scroll', onSelectionChange, true)
})
</script>

<template>
  <Teleport to="body">
    <button
      v-if="pos"
      type="button"
      class="fixed z-40 flex h-8 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-md"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${BUTTON_W}px` }"
      aria-label="Quote selection in reply"
      @pointerdown.prevent
      @mousedown.prevent
      @click="onClick"
    >
      <QuoteIcon class="size-3.5" />
      Quote
    </button>
  </Teleport>
</template>
