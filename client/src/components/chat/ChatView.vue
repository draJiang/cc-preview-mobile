<script setup lang="ts">
import { CircleAlertIcon, InfoIcon, SquareTerminalIcon, TriangleAlertIcon } from '@lucide/vue'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { MessageResponse } from '@/components/ai-elements/message'
import { useBlocks } from '@/composables/useBlocks'
import { useChat } from '@/composables/useChat'
import { useIsDark } from '@/composables/usePrefs'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import EmptyState from './EmptyState.vue'
import PermissionCard from './PermissionCard.vue'
import QuoteButton from './QuoteButton.vue'
import QuestionCard from './QuestionCard.vue'
import StepGroup from './StepGroup.vue'

const { currentSessionId } = useChat()
const { blocks, visibleRequestIds } = useBlocks()
const isDark = useIsDark()

// Track which request cards are on screen so the composer can point at
// pending ones that have scrolled away.
const root = ref<HTMLElement | null>(null)
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const id = (entry.target as HTMLElement).dataset.requestId
    if (!id)
      continue
    if (entry.isIntersecting)
      visibleRequestIds.add(id)
    else
      visibleRequestIds.delete(id)
  }
})
watch(blocks, async () => {
  await nextTick()
  root.value?.querySelectorAll<HTMLElement>('[data-request-id]').forEach(el => observer.observe(el))
}, { immediate: true })
watch(currentSessionId, () => visibleRequestIds.clear())
onBeforeUnmount(() => observer.disconnect())
</script>

<template>
  <div ref="root" class="relative flex min-h-0 flex-1 flex-col">
    <Conversation :key="currentSessionId ?? ''" class="min-h-0" aria-label="Conversation" :is-dark="isDark">
      <ConversationContent class="mx-auto w-full max-w-3xl gap-4 px-4 pt-4 pb-14">
        <EmptyState v-if="!blocks.some(b => b.type === 'user')" class="min-h-[55dvh]" />
        <template v-for="block in blocks" :key="block.id">
          <div v-if="block.type === 'user'" class="flex justify-end">
            <div data-quotable class="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-primary-foreground">
              <div v-if="block.quote" class="mb-1.5 line-clamp-3 border-l-2 border-primary-foreground/40 pl-2 text-[13px] leading-snug opacity-80">
                {{ block.quote }}
              </div>
              <div>{{ block.text }}</div>
            </div>
          </div>
          <MessageResponse
            v-else-if="block.type === 'assistant'"
            data-quotable
            :content="block.text"
            class="md-body text-[15px] leading-relaxed"
          />
          <StepGroup v-else-if="block.type === 'steps'" :steps="block.steps" />
          <PermissionCard v-else-if="block.type === 'permission'" :block="block" />
          <QuestionCard v-else-if="block.type === 'question'" :block="block" />
          <div v-else-if="block.type === 'note'" class="px-6 text-center text-xs text-muted-foreground">
            {{ block.text }}
          </div>
          <div
            v-else-if="block.type === 'notice'"
            class="flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed break-words"
            :class="{
              'bg-muted/60 text-muted-foreground': block.level === 'info',
              'bg-amber-500/10 text-amber-700 dark:text-amber-400': block.level === 'warning',
              'bg-destructive/10 text-destructive': block.level === 'error',
            }"
          >
            <CircleAlertIcon v-if="block.level === 'error'" class="mt-px size-3.5 shrink-0" />
            <TriangleAlertIcon v-else-if="block.level === 'warning'" class="mt-px size-3.5 shrink-0" />
            <InfoIcon v-else class="mt-px size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 whitespace-pre-wrap">{{ block.text }}</span>
          </div>
          <div v-else-if="block.type === 'compact'" class="flex items-center gap-3 text-[11px] text-muted-foreground/80">
            <div class="h-px flex-1 border-t border-dashed" />
            <span>{{ block.text }}</span>
            <div class="h-px flex-1 border-t border-dashed" />
          </div>
          <div v-else-if="block.type === 'command_output'" class="overflow-hidden rounded-lg border bg-card">
            <div class="flex items-center gap-2 border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <SquareTerminalIcon class="size-3.5" />
              Command output
            </div>
            <pre class="max-h-80 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap break-words">{{ block.text }}</pre>
          </div>
          <template v-else-if="block.type === 'result'">
            <div
              v-if="block.errorText"
              class="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words text-destructive"
            >
              <CircleAlertIcon class="mt-px size-3.5 shrink-0" />
              <span class="min-w-0 flex-1">{{ block.errorText }}</span>
            </div>
            <div v-if="block.text" class="flex items-center gap-3 text-[11px] text-muted-foreground/80">
              <div class="h-px flex-1 bg-border" />
              <span :class="block.isError && 'text-destructive'">{{ block.text }}</span>
              <div class="h-px flex-1 bg-border" />
            </div>
          </template>
        </template>
      </ConversationContent>
      <ConversationScrollButton class="bottom-3 size-9 shadow-md" aria-label="Scroll to bottom" />
    </Conversation>
    <QuoteButton />
  </div>
</template>
