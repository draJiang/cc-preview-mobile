import type { PermissionBlock, QuestionBlock } from '@/lib/turns'
import { buildBlocks } from '@/lib/turns'
import { computed, reactive } from 'vue'
import { useChat } from './useChat'

const { items } = useChat()

const blocks = computed(() => buildBlocks(items.value))

// Requests still waiting for the user; drives the "Pending" bar above the composer.
const pending = computed(() =>
  blocks.value.filter((b): b is PermissionBlock | QuestionBlock =>
    (b.type === 'permission' || b.type === 'question') && b.pending),
)

// Request cards currently on screen (maintained by ChatView's IntersectionObserver).
const visibleRequestIds = reactive(new Set<string>())

const offscreenPending = computed(() => pending.value.filter(b => !visibleRequestIds.has(b.id)))

function scrollToRequest(id: string) {
  document.querySelector(`[data-request-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

export function useBlocks() {
  return { blocks, pending, offscreenPending, visibleRequestIds, scrollToRequest }
}
