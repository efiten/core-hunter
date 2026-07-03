// Same-origin in production (nginx serves /api). Empty base = relative.
// Node-name resolution goes through the server's own same-origin
// /api/resolve proxy (see names.js) — no cross-origin corsproxy hop needed.
export const API_BASE = ''

// Per-SF node-count sources for the top-bar display. `pick` extracts the
// count from each endpoint's response shape (CoreScope stats vs nameresolver
// count endpoint).
export const NODE_COUNT_SOURCES = [
  { label: 'SF7', url: 'https://corsproxy.on8ar.eu/sf7/api/nodes/count', pick: (j) => j.count },
  { label: 'SF8', url: 'https://corsproxy.on8ar.eu/cs/api/stats', pick: (j) => j.totalNodes },
]
