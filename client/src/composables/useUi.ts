import { ref } from 'vue'

// Which overlay panel is open. Secondary UI lives in exactly two containers:
// the sessions sheet (navigation) and the settings drawer (everything else).

export type SettingsPage = 'main' | 'mode' | 'model'

const sessionsOpen = ref(false)
const settingsOpen = ref(false)
const settingsPage = ref<SettingsPage>('main')
// True when a sub-page was opened directly (e.g. from the composer); picking
// a value there should dismiss the drawer instead of showing the main page.
const settingsDirect = ref(false)

function openSettings(page: SettingsPage = 'main') {
  settingsPage.value = page
  settingsDirect.value = page !== 'main'
  settingsOpen.value = true
}

export function useUi() {
  return { sessionsOpen, settingsOpen, settingsPage, settingsDirect, openSettings }
}
