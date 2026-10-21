<script setup lang="ts">
import { ArrowUpIcon, BellDotIcon, ShieldIcon, SquareIcon } from '@lucide/vue'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { useBlocks } from '@/composables/useBlocks'
import { useChat } from '@/composables/useChat'
import { useUi } from '@/composables/useUi'
import { permissionModeLabel } from '@/lib/protocol'
import { cn } from '@/lib/utils'
import { computed, nextTick, ref } from 'vue'

const { isProcessing, permissionMode, sendMessage, interrupt, connection } = useChat()
const { offscreenPending, scrollToRequest } = useBlocks()
const { openSettings } = useUi()

const text = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const composing = ref(false)

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
  return [perms && `${perms} 个待审批`, qs && `${qs} 个待回答`].filter(Boolean).join('，')
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
  sendMessage(text.value.trim())
  text.value = ''
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
  <div class="shrink-0 bg-background px-3 pt-1 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
    <div class="mx-auto w-full max-w-3xl">
      <!-- Status row: only shows something when there is something to say -->
      <div
        v-if="pendingLabel || permissionMode !== 'default' || isProcessing"
        class="flex min-h-9 items-center gap-2 pb-1.5"
      >
        <button
          v-if="pendingLabel"
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm"
          @click="scrollToRequest(offscreenPending[0].id)"
        >
          <BellDotIcon class="size-3.5" />
          {{ pendingLabel }}
        </button>
        <Shimmer v-else-if="isProcessing" as="span" class="text-xs" :duration="1.6">
          Claude 正在工作…
        </Shimmer>
        <button
          v-if="permissionMode !== 'default'"
          type="button"
          class="ml-auto flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs text-muted-foreground"
          :aria-label="`权限模式：${permissionModeLabel(permissionMode)}，点按修改`"
          @click="openSettings('mode')"
        >
          <ShieldIcon class="size-3.5" />
          {{ permissionModeLabel(permissionMode) }}
        </button>
      </div>

      <div class="flex items-end gap-2 rounded-3xl border bg-card p-1.5 pl-4 shadow-xs focus-within:border-ring/60">
        <textarea
          ref="textarea"
          v-model="text"
          rows="1"
          placeholder="给 Claude Code 发消息…"
          enterkeyhint="send"
          aria-label="消息"
          class="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground"
          @input="autoGrow"
          @keydown="onKeydown"
          @compositionstart="composing = true"
          @compositionend="composing = false"
        />
        <button
          type="button"
          :aria-label="showStop ? '停止' : '发送'"
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
  </div>
</template>
