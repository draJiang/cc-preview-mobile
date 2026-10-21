export function relativeTime(ts: number) {
  const min = Math.floor((Date.now() - ts) / 60000)
  if (min < 1)
    return '刚刚'
  if (min < 60)
    return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24)
    return `${hr} 小时前`
  return `${Math.floor(hr / 24)} 天前`
}

export function formatResetTime(iso?: string) {
  if (!iso)
    return ''
  const d = new Date(iso)
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString())
    return `今天 ${time} 重置`
  const date = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${date} ${time} 重置`
}
