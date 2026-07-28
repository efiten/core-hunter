// Companion battery reading, via CMD_GET_STATS (56) / STATS_TYPE_CORE (0).
// Frame layout confirmed against upstream MeshCore firmware's own
// docs/stats_binary_frames.md — RESP_CODE_STATS (24) + STATS_TYPE_CORE (0), 11 bytes:
//   [0] response_code (0x18)  [1] stats_type (0x00)  [2-3] battery_mv (u16 LE)
//   [4-7] uptime_secs (u32 LE)  [8-9] errors (u16 LE)  [10] queue_len (u8)
const RESP_CODE_STATS = 24
const STATS_TYPE_CORE = 0

// AGENTS.md §7: firmware owns this, so these are firmware's numbers, not a
// curve of our own. The companion computes its own on-screen percentage with
// exactly this linear map:
//
//   examples/companion_radio/ui-new/UITask.cpp
//     #ifndef BATT_MIN_MILLIVOLTS
//       #define BATT_MIN_MILLIVOLTS 3000
//     #endif
//     #ifndef BATT_MAX_MILLIVOLTS
//       #define BATT_MAX_MILLIVOLTS 4200
//     #endif
//     batteryPercentage = ((mv - min) * 100) / (max - min)
//
// Using anything else means the companion's own screen and this app disagree
// about the same pack, which is worse than showing no percentage at all.
const MV_FULL = 4200
const MV_EMPTY = 3000

// Both defines are #ifndef-guarded, so a variant overrides them — and one does:
//   variants/lilygo_tbeam_1w/platformio.ini
//     -D BATT_MIN_MILLIVOLTS=6000
//     -D BATT_MAX_MILLIVOLTS=8400
// i.e. a 2S pack. We cannot read a build flag over the wire, so the endpoints
// are unknowable for such a board. Rather than clamping a 2S reading to a
// confident 100%, anything above a single cell's ceiling is reported as
// "voltage known, percentage unknown" and the caller shows volts only.
// The threshold sits above MV_FULL with headroom for a charging 1S pack
// (~4.3V) and well below a 2S pack's empty point (6000).
const MULTI_CELL_MV = 5000

// Ours, not firmware's — firmware defines no low-battery threshold. Expressed
// as a percentage so it rides on the firmware curve above rather than being a
// second, independent invented voltage: 20% is 3240mV on a 1S pack, and stays
// meaningful if the endpoints ever change. Unknown percentage is not "low":
// a multi-cell pack at 6100mV is genuinely flat, but we cannot tell, and a
// warning that fires on a guess is the same failure as one that never fires.
const LOW_BATTERY_PERCENT = 20

export function parseStatsCore(bytes) {
  if (!bytes || bytes.length < 11) return null
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b[0] !== RESP_CODE_STATS || b[1] !== STATS_TYPE_CORE) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const batteryMv = dv.getUint16(2, true)
  return {
    // A literal 0 is firmware's sentinel for "this board has no VBAT sense",
    // not a flat pack:
    //   src/helpers/ESP32Board.h      return 0;  // not supported
    //   src/helpers/stm32/STM32Board.h  return 0;  // not supported
    // Reported as a real reading it renders 0.00V (~0%) in the low style and
    // pins the BLE dot amber for an entire drive on a USB-powered companion —
    // a warning that is always on trains you to ignore the one that matters.
    batteryMv: batteryMv === 0 ? null : batteryMv,
    uptimeSecs: dv.getUint32(4, true),
    errors: dv.getUint16(8, true),
    queueLen: dv.getUint8(10),
  }
}

// True when the reading is above what a single cell can be, i.e. a multi-cell
// pack whose real endpoints are a build flag we cannot see.
export function isMultiCell(mv) {
  return Number.isFinite(mv) && mv >= MULTI_CELL_MV
}

// null means "no percentage can honestly be given" — no reading, or a pack
// whose endpoints we do not know. Callers show the raw voltage in that case.
export function mvToPercent(mv) {
  if (!Number.isFinite(mv)) return null
  if (isMultiCell(mv)) return null
  const pct = ((mv - MV_EMPTY) / (MV_FULL - MV_EMPTY)) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

export function isLowBattery(mv) {
  const pct = mvToPercent(mv)
  return pct !== null && pct <= LOW_BATTERY_PERCENT
}

const CMD_GET_STATS = 56

// requestStatsCore resolves { batteryMv, uptimeSecs, errors, queueLen } from
// the companion, or rejects on timeout/malformed response.
export function requestStatsCore(transport, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const onFrame = (dv) => {
      const b = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)
      const info = parseStatsCore(b)
      if (!info) return
      cleanup()
      resolve(info)
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error('STATS_CORE timeout')) }, timeoutMs)
    function cleanup() { clearTimeout(timer); transport.offFrame(onFrame) }
    transport.onFrame(onFrame)
    transport.send(new Uint8Array([CMD_GET_STATS, STATS_TYPE_CORE])).catch((e) => { cleanup(); reject(e) })
  })
}
