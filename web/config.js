// Same-origin in production (nginx serves /api). Empty base = relative.
export const API_BASE = ''

// CoreScope / nameresolver node-name resolvers (prefix -> {name, ambiguous}),
// tried in order — first unambiguous hit wins. Cross-origin via the same CORS
// proxy the scanner app uses. Empty array disables name lookup.
export const RESOLVE_URLS = [
  'https://corsproxy.on8ar.eu/cs/api/nodes/resolve',   // SF8 (CoreScope)
  'https://corsproxy.on8ar.eu/sf7/api/nodes/resolve',  // SF7 (nameresolver)
]
