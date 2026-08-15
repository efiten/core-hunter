// Worst positional accuracy (metres, 1-sigma as the W3C reports it) a fix may
// have and still be recorded against. Fixed rather than configurable: it is a
// property of what the hex grid can represent, not of a hunter's preference.
// 100 m is roughly the coarsest fix that still lands a reception in the right
// neighbourhood of a ~90 m hex cell, and matches MeshMapper's ping threshold.
// On production data a 50 m threshold would drop practically the same rows
// (13.7% vs 13.6%) — almost nothing was captured between 50 m and 100 m.
export const GPS_MAX_ACC_M = 100

// How often the "captures are being dropped" notice may appear. Without it, a
// drive through an urban canyon looks exactly like the app being broken.
export const POOR_FIX_NOTICE_MS = 30000

const inRange = (v, max) => Number.isFinite(v) && Math.abs(v) <= max

// isValidFix rejects coordinates that are unusable at all: NaN/non-numeric or
// out of range. iOS can emit an invalid CLLocation briefly after a resume,
// which aborts the map renderer and travels into the published payload.
export function isValidFix(fix) {
  return !!fix && inRange(fix.lat, 90) && inRange(fix.lon, 180)
}

// isUsableFix additionally requires the fix to be accurate enough to record a
// reception against. A fix with no accuracy figure at all is accepted: it says
// nothing about quality, and refusing it would discard every reception from a
// device that does not report one.
// A negative accuracy is refused rather than treated as "better than any
// threshold": CoreLocation uses horizontalAccuracy < 0 to mean the location is
// invalid, which is exactly the case this gate exists for.
export function isUsableFix(fix, maxAccM = GPS_MAX_ACC_M) {
  if (!isValidFix(fix)) return false
  if (fix.acc_m == null) return true
  return Number.isFinite(fix.acc_m) && fix.acc_m >= 0 && fix.acc_m <= maxAccM
}

// accuracyLabel describes a fix's accuracy for the dropped-capture notice.
// That notice is shown for every refusal, including the ones caused by an
// absent, negative or NaN acc_m, so it must never render "±NaN m".
export function accuracyLabel(fix) {
  const a = fix && fix.acc_m
  if (!Number.isFinite(a) || a < 0) return 'accuracy unknown'
  return `±${Math.round(a)} m`
}

// shouldNoticePoorFix throttles that notice to once per POOR_FIX_NOTICE_MS.
export function shouldNoticePoorFix(lastNoticeAtMs, nowMs) {
  return lastNoticeAtMs == null || nowMs - lastNoticeAtMs >= POOR_FIX_NOTICE_MS
}

// Phone GPS. Each reception is tagged with the latest fix; no fix → no row
// (coverage without a position is useless).
export class Gps {
  constructor() { this._last = null; this._watchId = null; }

  // start(onFix, onError): begins watching; onFix (optional) fires on every
  // position update so the UI can track GPS continuously, independent of RX
  // packets. onError (optional) fires on permission-denied/timeout/etc, so
  // the UI can surface it (e.g. the startup splash) instead of hunting
  // silently doing nothing.
  start(onFix, onError) {
    if (!navigator.geolocation) throw new Error('geolocation unavailable');
    this._watchId = navigator.geolocation.watchPosition(
      (p) => {
        // heading = course-over-ground, degrees clockwise from true north;
        // null when unavailable, NaN while stationary (W3C spec). speed in
        // m/s (null when unavailable) gates low-speed course jitter (#242).
        const fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc_m: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed };
        // A NaN/out-of-range fix is dropped at intake rather than stored: it
        // would otherwise become "the latest fix" and poison every reception
        // tagged with it until the next update (#274).
        if (!isValidFix(fix)) return;
        this._last = fix;
        if (onFix) onFix(fix);
      },
      (err) => { if (onError) onError(err); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  stop() { if (this._watchId != null) navigator.geolocation.clearWatch(this._watchId); this._watchId = null; }

  // latest() returns the most recent fix or null.
  latest() { return this._last; }
}
