<script setup lang="ts">
import { ChevronDownIcon, MenuIcon, Settings2Icon, WifiOffIcon } from '@lucide/vue'
import { useChat } from '@/composables/useChat'
import { useUi } from '@/composables/useUi'
import { computed, ref, watch } from 'vue'

const { currentSession, cwd, connection } = useChat()
const { sessionsOpen, openSettings } = useUi()

const projectName = computed(() => cwd.value.split('/').filter(Boolean).pop() || '')

// Only surface connection trouble; a brief reconnect blip shouldn't flash a banner.
const showOffline = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
watch(connection, (state) => {
  clearTimeout(timer)
  if (state === 'open')
    showOffline.value = false
  else
    timer = setTimeout(() => (showOffline.value = true), 800)
}, { immediate: true })
</script>

<template>
  <header class="shrink-0 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
    <div class="mx-auto flex h-14 max-w-3xl items-center gap-1 px-1.5">
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-accent"
        aria-label="会话列表"
        @click="sessionsOpen = true"
      >
        <MenuIcon class="size-5" />
      </button>
      <button
        type="button"
        class="flex min-w-0 flex-1 flex-col items-center px-2"
        aria-label="切换会话"
        @click="sessionsOpen = true"
      >
        <span class="flex max-w-full items-center gap-1 text-[15px] font-semibold">
          <span class="truncate">{{ currentSession?.title || 'Claude Code' }}</span>
          <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" />
        </span>
        <span v-if="projectName && projectName !== currentSession?.title" class="max-w-full truncate text-xs text-muted-foreground">{{ projectName }}</span>
      </button>
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-accent"
        aria-label="设置"
        @click="openSettings()"
      >
        <Settings2Icon class="size-5" />
      </button>
    </div>
    <div
      v-if="showOffline"
      role="status"
      class="flex items-center justify-center gap-2 bg-destructive/10 py-1.5 text-xs text-destructive"
    >
      <WifiOffIcon class="size-3.5" />
      连接已断开，正在重连…
    </div>
  </header>
</template>
