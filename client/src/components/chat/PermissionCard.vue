<script setup lang="ts">
import type { PermissionBlock } from '@/lib/turns'
import { CheckIcon, ShieldAlertIcon, XIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useChat } from '@/composables/useChat'
import { toolIcon, toolLabel, toolSummary } from '@/lib/tool-meta'
import { computed, ref } from 'vue'
import ToolInputView from './ToolInputView.vue'

const props = defineProps<{ block: PermissionBlock }>()
const { respondPermission, cwd } = useChat()

const alwaysAllow = ref(false)
const submitting = ref<'approve' | 'deny' | null>(null)

const icon = computed(() => toolIcon(props.block.toolName))
const summary = computed(() => toolSummary(props.block.toolName, props.block.input ?? {}, cwd.value))
function respond(approve: boolean) {
  submitting.value = approve ? 'approve' : 'deny'
  respondPermission(props.block.id, approve, approve && alwaysAllow.value)
}
</script>

<template>
  <!-- Resolved: collapse to a single status line -->
  <div v-if="!block.pending" class="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
    <component :is="icon" class="size-3.5" />
    <span class="truncate">{{ toolLabel(block.toolName) }} {{ summary }}</span>
    <span v-if="block.resolution === 'approved'" class="ml-auto flex shrink-0 items-center gap-1 text-success"><CheckIcon class="size-3.5" />Allowed</span>
    <span v-else-if="block.resolution === 'denied'" class="ml-auto flex shrink-0 items-center gap-1"><XIcon class="size-3.5" />Denied</span>
    <span v-else class="ml-auto shrink-0">Expired</span>
  </div>

  <div
    v-else
    :data-request-id="block.id"
    class="flex flex-col gap-3 rounded-xl border border-primary/40 bg-card p-3.5 shadow-sm"
  >
    <div class="flex items-start gap-2.5">
      <ShieldAlertIcon class="mt-0.5 size-5 shrink-0 text-primary" />
      <div class="min-w-0 flex-1">
        <div class="text-[15px] font-semibold leading-snug">
          {{ block.title }}
        </div>
        <div v-if="block.description" class="mt-0.5 text-sm text-muted-foreground">
          {{ block.description }}
        </div>
      </div>
    </div>
    <ToolInputView :tool-name="block.toolName" :input="block.input ?? {}" />
    <label class="flex min-h-9 items-center justify-between gap-3 text-sm">
      <span class="text-muted-foreground">Always allow this session</span>
      <Switch v-model="alwaysAllow" />
    </label>
    <div class="grid grid-cols-2 gap-2">
      <Button variant="outline" class="h-11" :disabled="!!submitting" @click="respond(false)">
        Deny
      </Button>
      <Button class="h-11" :disabled="!!submitting" @click="respond(true)">
        Allow
      </Button>
    </div>
  </div>
</template>
