<script setup lang="ts">
import { ClipboardListIcon, Maximize2Icon } from '@lucide/vue'
import { MessageResponse } from '@/components/ai-elements/message'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'

// An ExitPlanMode plan, rendered as Markdown so it reads like the plan it is
// rather than a JSON string. Inline it is height-capped; long plans get a
// full-screen reader.
const props = defineProps<{ plan: string }>()

const open = ref(false)
const body = ref<HTMLElement | null>(null)
const { height } = useElementSize(body)
// Matches the inline max height below (24rem).
const overflowing = computed(() => height.value > 384)
</script>

<template>
  <div class="relative overflow-hidden rounded-lg border bg-background">
    <div class="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
      <ClipboardListIcon class="size-3.5" />
      <span class="flex-1">计划</span>
      <button
        type="button"
        class="-my-1 -mr-1.5 flex min-h-8 items-center gap-1 rounded-md px-2 text-primary active:bg-muted"
        @click="open = true"
      >
        <Maximize2Icon class="size-3.5" />
        全屏阅读
      </button>
    </div>
    <div class="max-h-96 overflow-hidden">
      <div ref="body" class="px-3.5 py-3">
        <MessageResponse :content="props.plan" class="md-body text-[15px] leading-relaxed" />
      </div>
    </div>
    <button
      v-if="overflowing"
      type="button"
      class="absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-background via-background/90 to-transparent pb-2 text-sm font-medium text-primary"
      @click="open = true"
    >
      展开全文
    </button>
  </div>

  <Sheet v-model:open="open">
    <SheetContent side="bottom" class="h-[92dvh] gap-0 rounded-t-2xl p-0">
      <SheetHeader class="border-b px-4 py-3 pr-12">
        <SheetTitle class="flex items-center gap-2 text-base">
          <ClipboardListIcon class="size-4" />
          计划
        </SheetTitle>
        <SheetDescription class="sr-only">
          完整的计划内容
        </SheetDescription>
      </SheetHeader>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <MessageResponse :content="props.plan" class="md-body mx-auto max-w-3xl text-[16px] leading-relaxed" />
      </div>
    </SheetContent>
  </Sheet>
</template>
