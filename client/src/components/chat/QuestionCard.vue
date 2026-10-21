<script setup lang="ts">
import type { Answer } from '@/lib/protocol'
import type { QuestionBlock } from '@/lib/turns'
import { CheckIcon, MessageCircleQuestionIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChat } from '@/composables/useChat'
import { cn } from '@/lib/utils'
import { computed, reactive, ref } from 'vue'

const props = defineProps<{ block: QuestionBlock }>()
const { answerQuestion, skipQuestion } = useChat()

// Per question: the picked option labels and the free-text "Other" answer.
// Typing an "other" answer clears the picks and vice versa.
const picked = reactive<Record<string, string[]>>({})
const other = reactive<Record<string, string>>({})
const submitting = ref(false)

function isPicked(q: string, label: string) {
  return picked[q]?.includes(label) ?? false
}

function toggle(q: string, label: string, multi?: boolean) {
  other[q] = ''
  const cur = picked[q] ?? []
  if (multi)
    picked[q] = cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label]
  else
    picked[q] = [label]
}

function onOther(q: string, value: string) {
  other[q] = value
  if (value.trim())
    picked[q] = []
}

const answers = computed(() => {
  const out: Record<string, Answer> = {}
  for (const q of props.block.questions) {
    const text = other[q.question]?.trim()
    const labels = picked[q.question] ?? []
    if (text)
      out[q.question] = text
    else if (labels.length)
      out[q.question] = q.multiSelect ? labels : labels[0]
  }
  return out
})

const complete = computed(() => props.block.questions.every(q => answers.value[q.question] !== undefined))

function submit() {
  submitting.value = true
  answerQuestion(props.block.id, answers.value)
}
function skip() {
  submitting.value = true
  skipQuestion(props.block.id)
}

function formatAnswer(a: Answer | undefined) {
  return Array.isArray(a) ? a.join('、') : (a ?? '')
}
</script>

<template>
  <!-- Resolved -->
  <div v-if="!block.pending" class="flex flex-col gap-1 rounded-xl border bg-card/50 p-3 text-sm">
    <div class="flex items-center gap-2 text-xs text-muted-foreground">
      <MessageCircleQuestionIcon class="size-3.5" />
      {{ block.resolution === 'answered' ? 'Answered' : block.resolution === 'skipped' ? 'Skipped' : 'Expired' }}
    </div>
    <template v-if="block.resolution === 'answered'">
      <div v-for="q in block.questions" :key="q.question" class="min-w-0">
        <span class="text-muted-foreground">{{ q.header || q.question }}：</span>
        <span class="font-medium">{{ formatAnswer(block.answers?.[q.question]) }}</span>
      </div>
    </template>
  </div>

  <div
    v-else
    :data-request-id="block.id"
    class="flex flex-col gap-5 rounded-xl border border-primary/40 bg-card p-3.5 shadow-sm"
  >
    <div v-for="q in block.questions" :key="q.question" class="flex flex-col gap-2">
      <div v-if="q.header" class="text-xs font-medium tracking-wide text-primary">
        {{ q.header }}
      </div>
      <div class="text-[15px] font-semibold leading-snug">
        {{ q.question }}
      </div>
      <div class="text-xs text-muted-foreground">
        {{ q.multiSelect ? 'Multi-select' : 'Single choice' }}
      </div>
      <div class="flex flex-col gap-2" :role="q.multiSelect ? 'group' : 'radiogroup'">
        <button
          v-for="opt in q.options"
          :key="opt.label"
          type="button"
          :role="q.multiSelect ? 'checkbox' : 'radio'"
          :aria-checked="isPicked(q.question, opt.label)"
          :class="cn(
            'flex min-h-11 w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
            isPicked(q.question, opt.label) ? 'border-primary bg-primary/8' : 'hover:bg-accent',
          )"
          @click="toggle(q.question, opt.label, q.multiSelect)"
        >
          <span
            :class="cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center border',
              q.multiSelect ? 'rounded' : 'rounded-full',
              isPicked(q.question, opt.label) ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
            )"
          >
            <CheckIcon v-if="isPicked(q.question, opt.label)" class="size-3" />
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-medium">{{ opt.label }}</span>
            <span v-if="opt.description" class="mt-0.5 block text-xs text-muted-foreground">{{ opt.description }}</span>
          </span>
        </button>
        <Input
          :model-value="other[q.question] ?? ''"
          placeholder="Other, type here…"
          class="h-11"
          @update:model-value="onOther(q.question, String($event))"
        />
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <Button variant="outline" class="h-11" :disabled="submitting" @click="skip">
        Skip
      </Button>
      <Button class="h-11" :disabled="!complete || submitting" @click="submit">
        Send answer
      </Button>
    </div>
  </div>
</template>
