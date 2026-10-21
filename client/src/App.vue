<script setup lang="ts">
import AppHeader from '@/components/chat/AppHeader.vue'
import ChatView from '@/components/chat/ChatView.vue'
import Composer from '@/components/chat/Composer.vue'
import SessionsSheet from '@/components/chat/SessionsSheet.vue'
import SettingsDrawer from '@/components/chat/SettingsDrawer.vue'
import { Toaster } from '@/components/ui/sonner'
import { useChat } from '@/composables/useChat'
import { usePrefs } from '@/composables/usePrefs'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import 'vue-sonner/style.css'

useChat()
usePrefs()

// iOS Safari doesn't shrink the layout viewport when the keyboard opens, so
// size the app to the visual viewport to keep the composer above the keyboard.
const height = ref<string | undefined>()
function syncViewport() {
  const vv = window.visualViewport
  if (!vv)
    return
  height.value = `${vv.height}px`
  window.scrollTo(0, 0)
}
onMounted(() => {
  window.visualViewport?.addEventListener('resize', syncViewport)
  syncViewport()
})
onBeforeUnmount(() => window.visualViewport?.removeEventListener('resize', syncViewport))
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden" :style="{ height }">
    <AppHeader />
    <ChatView />
    <Composer />
  </div>
  <SessionsSheet />
  <SettingsDrawer />
  <Toaster position="top-center" :offset="{ top: 'calc(env(safe-area-inset-top) + 12px)' }" />
</template>
