export function relativeTime(ts: number) {
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1)
    return 'Just now'
  if (min < 60)
    return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)
    return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export function formatResetTime(iso?: string) {
  if (!iso)
    return ''
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString())
    return `Resets today ${time}`
  const date = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  return `Resets ${date} ${time}`
}
