import { ref } from 'vue'

// Text the user picked to quote in their next message (one at a time; picking
// another selection replaces it).
const quote = ref<string | null>(null)

function setQuote(text: string) {
  quote.value = text
}

function clearQuote() {
  quote.value = null
}

export function useQuote() {
  return { quote, setQuote, clearQuote }
}
