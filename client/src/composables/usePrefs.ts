import { reactive, ref, watch } from 'vue'

// Per-device display preferences, kept in localStorage.

export type Theme = 'system' | 'light' | 'dark'

interface Prefs {
  theme: Theme
  expandTools: boolean
  expandThinking: boolean
}

const STORAGE_KEY = 'cc-mobile-prefs'
const defaults: Prefs = { theme: 'system', expandTools: false, expandThinking: false }

function load(): Prefs {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  }
  catch {
    return { ...defaults }
  }
}

const prefs = reactive<Prefs>(load())

const media = window.matchMedia('(prefers-color-scheme: dark)')
const isDark = ref(false)

function applyTheme() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && media.matches)
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]:not([media])')?.remove()
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = dark ? '#1c1c1c' : '#fafafa'
  document.head.appendChild(meta)
}

media.addEventListener('change', applyTheme)
applyTheme()

watch(prefs, () => {
  applyTheme()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  }
  catch {}
})

export function usePrefs() {
  return prefs
}

export function useIsDark() {
  return isDark
}
