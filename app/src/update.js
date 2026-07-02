// Update-check helpers (#132 follow-up). Pure logic only — the version.json
// fetch and the Settings reload button live in app.js. The running build's
// version is baked in as __APP_VERSION__; the deployed version is read from
// /version.json (emitted at build, served no-cache) and compared here.

// parseVersion pulls the version string out of a version.json payload, or
// null when the payload is missing/malformed (dev server, network error).
export function parseVersion(text) {
  try {
    const v = JSON.parse(text).version
    return typeof v === 'string' && v ? v : null
  } catch { return null }
}

// compareVersions does a numeric major.minor.patch compare: 1 if a>b, -1 if
// a<b, 0 if equal. Missing trailing components count as zero.
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

// isUpdateAvailable is true only when `latest` is a strictly newer version
// than `current`. A null/blank or older latest (stale/failed fetch) never
// reports an update, so the reload prompt can't nag falsely.
export function isUpdateAvailable(current, latest) {
  if (!latest) return false
  return compareVersions(latest, current) > 0
}
