import { ref } from 'vue'

// Which overlay panel is open. Secondary UI lives in exactly two containers:
// the sessions sheet (navigation) and the settings drawer (everything else).

export type SettingsPage = 'main' | 'mode' | 'model'

const sessionsOpen = ref(false)
const settingsOpen = ref(false)
const settingsPage = ref<SettingsPage>('main')

function openSettings(page: SettingsPage = 'main') {
  settingsPage.value = page
  settingsOpen.value = true
}

export function useUi() {
  return { sessionsOpen, settingsOpen, settingsPage, openSettings }
}
