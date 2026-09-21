// Pure decisions about publishing to several brokers at once (#554). No DOM,
// no network, no IndexedDB -- app.js feeds these what it knows.

// pruneFloor is how far retention may delete: the watermark of the broker that
// is furthest behind. A reception is only safe to drop once every broker that
// is owed it has it. `brokers` are the ones that are ON: [{ id, watermark }].
// With none on, nothing is owed to anyone and age alone decides.
export function pruneFloor(brokers) {
  if (!brokers || brokers.length === 0) return Infinity
  return Math.min(...brokers.map((b) => b.watermark))
}

// dotState folds the brokers that are on into the one MQTT dot in the top bar.
// `connected` is one boolean per broker. 'partial' is the state a single dot
// could not show before: the socket to one broker is up while another is owed
// a backlog.
export function dotState(connected) {
  const up = (connected || []).filter(Boolean).length
  if (up === 0) return 'off'
  return up === connected.length ? 'on' : 'partial'
}
