const FEED_KINDS = new Set(['channel_name', 'advert_pubkey'])

export function feedItems(records, { ignore, limit = 50 } = {}) {
  const ig = ignore || new Set()
  return (records || [])
    .filter((r) => FEED_KINDS.has(r.sender_kind))
    .filter((r) => !(r.sender_id != null && ig.has(String(r.sender_id).toLowerCase())))
    .slice()
    .sort((a, b) => Date.parse(b.rx_at) - Date.parse(a.rx_at))
    .slice(0, limit)
}

export function relTime(rxAt, nowMs) {
  if (rxAt == null || Number.isNaN(Date.parse(rxAt))) return '—'
  const s = Math.max(0, Math.round((nowMs - Date.parse(rxAt)) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  return Math.floor(s / 3600) + 'h'
}
