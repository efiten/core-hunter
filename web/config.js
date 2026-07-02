// Same-origin in production (nginx serves /api). Empty base = relative.
export const API_BASE = ''

// CoreScope / nameresolver node-name resolvers (prefix -> {name, ambiguous}),
// tried in order — first unambiguous hit wins. Cross-origin via the same CORS
// proxy the scanner app uses. Empty array disables name lookup.
export const RESOLVE_URLS = [
  'https://corsproxy.on8ar.eu/cs/api/nodes/resolve',   // SF8 (CoreScope)
  'https://corsproxy.on8ar.eu/sf7/api/nodes/resolve',  // SF7 (nameresolver)
]

// Per-SF node-count sources for the top-bar display. `pick` extracts the
// count from each endpoint's response shape (CoreScope stats vs nameresolver
// count endpoint).
export const NODE_COUNT_SOURCES = [
  { label: 'SF7', url: 'https://corsproxy.on8ar.eu/sf7/api/nodes/count', pick: (j) => j.count },
  { label: 'SF8', url: 'https://corsproxy.on8ar.eu/cs/api/stats', pick: (j) => j.totalNodes },
]
