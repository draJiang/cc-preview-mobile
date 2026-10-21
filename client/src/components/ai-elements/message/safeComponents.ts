import type { Component } from 'vue'

// Raw HTML in model output is parsed into real elements. The renderer already
// strips on* handlers and javascript: URLs; additionally drop elements that
// can load remote content, submit data, or alter the page, matching what the
// old DOMPurify-based client allowed.
const Dropped: Component = { name: 'DroppedHtml', render: () => null }

const BLOCKED_TAGS = [
  'script', 'style', 'link', 'meta', 'base', 'title',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
  'form', 'input', 'button', 'select', 'option', 'textarea',
  'audio', 'video', 'source', 'track',
  'svg', 'math', 'template', 'slot', 'dialog',
]

export const safeComponents: Record<string, Component> = Object.fromEntries(
  BLOCKED_TAGS.map(tag => [tag, Dropped]),
)
