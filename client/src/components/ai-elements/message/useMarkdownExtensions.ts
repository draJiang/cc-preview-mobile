import type { Extensions, MarkdownProviderContext } from 'vue-stream-markdown'
import { code } from '@stream-markdown/code'
import { useMarkdownProvider } from 'vue-stream-markdown'

// Only code highlighting is enabled; math and mermaid are left out to keep the
// mobile bundle small.
export function useMarkdownExtensions(): {
  provider: MarkdownProviderContext | undefined
  extensions: Extensions | undefined
} {
  const provider = useMarkdownProvider()
  const extensions = provider ? undefined : { code: code() }
  return { provider, extensions }
}
