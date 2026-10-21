<script setup lang="ts">
import type { UsageWindow } from '@/lib/protocol'
import type { Theme } from '@/composables/usePrefs'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, MonitorIcon, MoonIcon, SunIcon } from '@lucide/vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { useChat } from '@/composables/useChat'
import { usePrefs } from '@/composables/usePrefs'
import { useUi } from '@/composables/useUi'
import { PERMISSION_MODES, permissionModeLabel } from '@/lib/protocol'
import { formatResetTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

const chat = useChat()
const { cwd, permissionMode, modelOptions, selectedModel, selectedModelLabel, usage, connection, currentSessionId, currentSession } = chat
const prefs = usePrefs()
const { settingsOpen, settingsPage, settingsDirect } = useUi()

const confirmClose = ref(false)
const host = location.host

// Paths are long; keep the meaningful tail visible.
const shortCwd = computed(() => {
  const parts = cwd.value.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : cwd.value
})

watch(settingsOpen, (open) => {
  if (open)
    chat.refreshUsage()
})

const title = computed(() => ({ main: 'Settings', mode: 'Permission mode', model: 'Model' })[settingsPage.value])

const themes: { value: Theme, label: string, icon: typeof SunIcon }[] = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
]

function usageRow(win?: UsageWindow) {
  const used = win?.utilization
  const has = typeof used === 'number'
  const pct = has ? Math.min(100, Math.max(0, used)) : 0
  const meta = [has ? `${Math.round(100 - used)}% left` : 'No data']
  if (win?.resets_at)
    meta.push(formatResetTime(win.resets_at))
  return { pct, high: pct >= 90, meta: meta.join(' · ') }
}

const usageRows = computed(() => {
  const limits = usage.value.data?.rate_limits
  if (!usage.value.data?.rate_limits_available || !limits)
    return []
  return [
    { label: '5-hour limit', ...usageRow(limits.five_hour) },
    { label: 'Weekly limit', ...usageRow(limits.seven_day) },
  ]
})

function leaveSubPage() {
  if (settingsDirect.value)
    settingsOpen.value = false
  else
    settingsPage.value = 'main'
}

function pickMode(mode: string) {
  if (mode !== permissionMode.value)
    chat.setPermissionMode(mode)
  leaveSubPage()
}

// The SDK lists the current aliases (default/opus/sonnet/...) followed by
// pinned ids of older models. Keep the aliases up front and fold the rest.
const isPinned = (value: string) => value.startsWith('claude-')
const mainModels = computed(() => modelOptions.value.filter(m => !isPinned(m.value)))
const olderModels = computed(() => modelOptions.value.filter(m => isPinned(m.value)))
const showOlder = ref(false)
watch(() => settingsPage.value, (page) => {
  if (page === 'model')
    showOlder.value = isPinned(selectedModel.value)
})

function pickModel(model: string) {
  if (model !== selectedModel.value)
    chat.setModel(model)
  leaveSubPage()
}

async function copyCwd() {
  try {
    await navigator.clipboard.writeText(cwd.value)
    toast.success('Path copied')
  }
  catch {
    toast.error('Copy failed')
  }
}

function closeCurrent() {
  if (currentSessionId.value)
    chat.closeSession(currentSessionId.value)
  confirmClose.value = false
  settingsOpen.value = false
}
</script>

<template>
  <Drawer v-model:open="settingsOpen">
    <DrawerContent class="max-h-[88dvh] pb-[env(safe-area-inset-bottom)]">
      <div class="relative flex h-12 shrink-0 items-center justify-center px-12">
        <button
          v-if="settingsPage !== 'main'"
          type="button"
          class="absolute left-2 flex size-10 items-center justify-center rounded-full hover:bg-accent"
          aria-label="Back"
          @click="settingsPage = 'main'"
        >
          <ChevronLeftIcon class="size-5" />
        </button>
        <DrawerTitle class="text-base font-semibold">
          {{ title }}
        </DrawerTitle>
        <DrawerDescription class="sr-only">
          Session and display settings
        </DrawerDescription>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <!-- Main page -->
        <div v-if="settingsPage === 'main'" class="flex flex-col gap-6">
          <section>
            <h3 class="settings-label">
              Current session
            </h3>
            <div class="settings-group">
              <button type="button" class="settings-row" @click="settingsPage = 'mode'">
                <span>Permission mode</span>
                <span class="settings-value">{{ permissionModeLabel(permissionMode) }}</span>
                <ChevronRightIcon class="size-4 text-muted-foreground" />
              </button>
              <button type="button" class="settings-row" @click="settingsPage = 'model'">
                <span>Model</span>
                <span class="settings-value">{{ selectedModelLabel }}</span>
                <ChevronRightIcon class="size-4 text-muted-foreground" />
              </button>
              <button type="button" class="settings-row" aria-label="Copy working directory" @click="copyCwd">
                <span class="shrink-0">Working directory</span>
                <span class="settings-value font-mono text-xs">{{ shortCwd }}</span>
                <CopyIcon class="size-4 shrink-0 text-muted-foreground" />
              </button>
            </div>
          </section>

          <section>
            <h3 class="settings-label">
              Usage
            </h3>
            <div class="settings-group gap-4 p-4">
              <div v-if="usage.loading && !usage.data" class="text-sm text-muted-foreground">
                Loading…
              </div>
              <div v-else-if="usage.error" class="text-sm text-destructive">
                {{ usage.error }}
              </div>
              <div v-else-if="!usageRows.length" class="text-sm text-muted-foreground">
                No plan limit data for this account (possibly billed via API key)
              </div>
              <div v-for="row in usageRows" :key="row.label" class="flex flex-col gap-1.5">
                <div class="text-sm font-medium">
                  {{ row.label }}
                </div>
                <Progress :model-value="row.pct" :class="cn('bg-muted', row.high && '[&>*]:bg-destructive')" />
                <div class="text-xs text-muted-foreground">
                  {{ row.meta }}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 class="settings-label">
              Display
            </h3>
            <div class="settings-group">
              <div class="grid grid-cols-3 gap-1.5 p-1.5">
                <button
                  v-for="t in themes"
                  :key="t.value"
                  type="button"
                  :class="cn('flex h-11 items-center justify-center gap-1.5 rounded-lg text-sm', prefs.theme === t.value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')"
                  :aria-pressed="prefs.theme === t.value"
                  @click="prefs.theme = t.value"
                >
                  <component :is="t.icon" class="size-4" />
                  {{ t.label }}
                </button>
              </div>
              <label class="settings-row">
                <span>Expand tool details by default</span>
                <Switch v-model="prefs.expandTools" class="ml-auto" />
              </label>
              <label class="settings-row">
                <span>Expand thinking by default</span>
                <Switch v-model="prefs.expandThinking" class="ml-auto" />
              </label>
            </div>
          </section>

          <section>
            <h3 class="settings-label">
              Connection
            </h3>
            <div class="settings-group">
              <div class="settings-row">
                <span>Status</span>
                <span :class="cn('settings-value', connection === 'open' ? 'text-success' : 'text-destructive')">
                  {{ connection === 'open' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Disconnected' }}
                </span>
              </div>
              <div class="settings-row">
                <span>Server</span>
                <span class="settings-value font-mono text-xs">{{ host }}</span>
              </div>
            </div>
          </section>

          <section>
            <div class="settings-group">
              <button type="button" class="settings-row justify-center text-destructive" :disabled="!currentSession" @click="confirmClose = true">
                Close current session
              </button>
            </div>
          </section>
        </div>

        <!-- Permission mode -->
        <div v-else-if="settingsPage === 'mode'" class="settings-group" role="radiogroup">
          <button
            v-for="m in PERMISSION_MODES"
            :key="m.value"
            type="button"
            role="radio"
            :aria-checked="permissionMode === m.value"
            class="settings-row items-start py-3"
            @click="pickMode(m.value)"
          >
            <span class="min-w-0 flex-1 text-left">
              <span class="block">{{ m.label }}</span>
              <span class="mt-0.5 block text-xs text-muted-foreground">{{ m.description }}</span>
            </span>
            <CheckIcon v-if="permissionMode === m.value" class="mt-0.5 size-4 text-primary" />
          </button>
        </div>

        <!-- Model -->
        <div v-else class="flex flex-col gap-3">
          <div class="settings-group" role="radiogroup" aria-label="Model">
            <button
              v-for="m in mainModels"
              :key="m.value"
              type="button"
              role="radio"
              :aria-checked="selectedModel === m.value"
              class="settings-row items-start py-3"
              @click="pickModel(m.value)"
            >
              <span class="min-w-0 flex-1 text-left">
                <span class="block">{{ m.displayName || m.value }}</span>
                <span v-if="m.description" class="mt-0.5 block text-xs text-muted-foreground">{{ m.description }}</span>
              </span>
              <CheckIcon v-if="selectedModel === m.value" class="mt-0.5 size-4 text-primary" />
            </button>
          </div>
          <template v-if="olderModels.length">
            <button
              type="button"
              class="flex min-h-10 items-center gap-1 self-start px-1 text-sm text-muted-foreground"
              :aria-expanded="showOlder"
              @click="showOlder = !showOlder"
            >
              Older models ({{ olderModels.length }})
              <ChevronRightIcon :class="cn('size-4 transition-transform', showOlder && 'rotate-90')" />
            </button>
            <div v-if="showOlder" class="settings-group" role="radiogroup" aria-label="Older models">
              <button
                v-for="m in olderModels"
                :key="m.value"
                type="button"
                role="radio"
                :aria-checked="selectedModel === m.value"
                class="settings-row py-2.5"
                @click="pickModel(m.value)"
              >
                <span class="min-w-0 flex-1 text-left">{{ m.displayName || m.value }}</span>
                <CheckIcon v-if="selectedModel === m.value" class="size-4 text-primary" />
              </button>
            </div>
          </template>
        </div>
      </div>
    </DrawerContent>
  </Drawer>

  <AlertDialog v-model:open="confirmClose">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Close current session?</AlertDialogTitle>
        <AlertDialogDescription>
          The chat history of “{{ currentSession?.title }}” will be deleted and can't be recovered.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction class="bg-destructive text-white hover:bg-destructive/90" @click="closeCurrent">
          Close session
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<style scoped>
@reference "@/styles/globals.css";

.settings-label {
  @apply px-1 pb-1.5 text-xs font-medium text-muted-foreground;
}
.settings-group {
  @apply flex flex-col overflow-hidden rounded-xl bg-muted/60;
}
.settings-row {
  @apply flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] not-last:border-b border-border/60 disabled:opacity-50;
}
.settings-value {
  @apply ml-auto min-w-0 truncate text-sm text-muted-foreground;
}
</style>
