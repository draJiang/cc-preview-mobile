<script setup lang="ts">
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { MessageResponse } from '@/components/ai-elements/message'
import { useBlocks } from '@/composables/useBlocks'
import { useChat } from '@/composables/useChat'
import { useIsDark } from '@/composables/usePrefs'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import EmptyState from './EmptyState.vue'
import PermissionCard from './PermissionCard.vue'
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
            <div class="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-primary-foreground">
              {{ block.text }}
            </div>
          </div>
          <MessageResponse
            v-else-if="block.type === 'assistant'"
            :content="block.text"
            class="md-body text-[15px] leading-relaxed"
          />
          <StepGroup v-else-if="block.type === 'steps'" :steps="block.steps" />
          <PermissionCard v-else-if="block.type === 'permission'" :block="block" />
          <QuestionCard v-else-if="block.type === 'question'" :block="block" />
          <div v-else-if="block.type === 'note'" class="px-6 text-center text-xs text-muted-foreground">
            {{ block.text }}
          </div>
          <div v-else-if="block.type === 'result'" class="flex items-center gap-3 text-[11px] text-muted-foreground/80">
            <div class="h-px flex-1 bg-border" />
            <span :class="block.isError && 'text-destructive'">{{ block.text }}</span>
            <div class="h-px flex-1 bg-border" />
          </div>
        </template>
      </ConversationContent>
      <ConversationScrollButton class="bottom-3 size-9 shadow-md" aria-label="Scroll to bottom" />
    </Conversation>
  </div>
</template>
