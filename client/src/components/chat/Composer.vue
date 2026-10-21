<script setup lang="ts">
import { ArrowUpIcon, BellDotIcon, SquareIcon, XIcon } from '@lucide/vue'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useBlocks } from '@/composables/useBlocks'
import { useChat } from '@/composables/useChat'
import { useQuote } from '@/composables/useQuote'
import { useUi } from '@/composables/useUi'
import { permissionModeLabel } from '@/lib/protocol'
import { cn } from '@/lib/utils'
import { computed, nextTick, ref, watch } from 'vue'

const { isProcessing, permissionMode, selectedModelLabel, sendMessage, interrupt, connection, currentSessionId } = useChat()
const { offscreenPending, scrollToRequest } = useBlocks()
const { openSettings } = useUi()
const { quote, clearQuote } = useQuote()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const composing = ref(false)

// Picking a quote means the user is about to reply to it.
watch(quote, (q) => {
  if (q)
    textarea.value?.focus()
})
watch(currentSessionId, clearQuote)

// Messages sent mid-turn are queued by the server, so the button only turns
// into "stop" while Claude is working and there is nothing typed.
const showStop = computed(() => isProcessing.value && !text.value.trim())
const canSend = computed(() => !!text.value.trim() && connection.value === 'open')

const pendingLabel = computed(() => {
  const list = offscreenPending.value
  if (!list.length)
    return ''
  const perms = list.filter(b => b.type === 'permission').length
  const qs = list.length - perms
  return [perms && `${perms} awaiting approval`, qs && `${qs} awaiting answer`].filter(Boolean).join(', ')
})

function autoGrow() {
  const el = textarea.value
  if (!el)
    return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

function submit() {
  if (!canSend.value)
    return
  sendMessage(text.value.trim(), quote.value ?? undefined)
  text.value = ''
  clearQuote()
  nextTick(autoGrow)
}

function onButton() {
  if (showStop.value)
    interrupt()
  else
    submit()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !composing.value && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="relative shrink-0 px-3 pt-1 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
    <div class="mx-auto w-full max-w-3xl">
      <!-- Floating status row: no background and no layout space of its own, so
           the chat stays readable underneath; only the chips themselves catch taps. -->
      <div
        v-if="pendingLabel || isProcessing"
        class="pointer-events-none absolute inset-x-3 bottom-full flex items-center pb-1.5"
      >
        <div class="mx-auto flex w-full max-w-3xl items-center">
          <button
            v-if="pendingLabel"
            type="button"
            class="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-md"
            @click="scrollToRequest(offscreenPending[0].id)"
          >
            <BellDotIcon class="size-3.5" />
            {{ pendingLabel }}
          </button>
          <span
            v-else
            class="pointer-events-auto flex h-7 items-center rounded-full bg-background/90 px-3 shadow-sm backdrop-blur"
          >
            <Shimmer as="span" class="text-xs" :duration="1.6">
              Claude is working…
            </Shimmer>
          </span>
        </div>
      </div>

      <div class="rounded-3xl border bg-card p-1.5 pl-4 shadow-xs focus-within:border-ring/60">
        <div v-if="quote" class="flex items-start gap-2 pt-1.5 pb-1">
          <div class="line-clamp-2 min-w-0 flex-1 border-l-2 border-primary/50 pl-2 text-[13px] leading-snug whitespace-pre-wrap break-words text-muted-foreground">
            {{ quote }}
          </div>
          <button
            type="button"
            aria-label="Remove quote"
            class="-mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            @click="clearQuote"
          >
            <XIcon class="size-3.5" />
          </button>
        </div>
        <div class="flex items-end gap-2">
          <textarea
            ref="textarea"
            v-model="text"
            rows="1"
            placeholder="Message Claude Code…"
            enterkeyhint="send"
            aria-label="Message"
            class="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground"
            @input="autoGrow"
            @keydown="onKeydown"
            @compositionstart="composing = true"
            @compositionend="composing = false"
          />
          <button
            type="button"
            :aria-label="showStop ? 'Stop' : 'Send'"
            :disabled="!showStop && !canSend"
            :class="cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors',
              showStop ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground',
            )"
            @click="onButton"
          >
            <SquareIcon v-if="showStop" class="size-3.5 fill-current" />
            <ArrowUpIcon v-else class="size-5" />
          </button>
        </div>
      </div>

      <!-- Persistent info row below the input: plain small text, tap to change -->
      <div class="flex items-center justify-between gap-3 px-3 pt-1 text-xs text-muted-foreground">
        <button
          type="button"
          class="min-w-0 truncate py-1 active:text-foreground"
          :class="permissionMode !== 'default' && 'text-foreground'"
          :aria-label="`Permission mode: ${permissionModeLabel(permissionMode)}. Tap to change`"
          @click="openSettings('mode')"
        >
          {{ permissionModeLabel(permissionMode) }}
        </button>
        <button
          v-if="selectedModelLabel"
          type="button"
          class="min-w-0 truncate py-1 active:text-foreground"
          :aria-label="`Model: ${selectedModelLabel}. Tap to change`"
          @click="openSettings('model')"
        >
          {{ selectedModelLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
