import { bytesToHex } from './decode.js'
import { isUsableFix } from './gps.js'

// Zero-hop rule (iteration 2): only direct receptions are captured/published,
// and only against a fix good enough to place them (#274) — once a reception
// is binned into the hex grid there is no way to un-see it, so a poor fix is
// refused here rather than filtered downstream.
export function shouldCapture(cls, fix) {
  return !!cls && cls.isDirect === true && isUsableFix(fix)
}

export function buildRecord(frame, cls, gps, nowIso) {
  return {
    rx_at: nowIso,
    raw: bytesToHex(frame.raw),
    snr: frame.snr,
    rssi: frame.rssi,
    lat: gps.lat,
    lon: gps.lon,
    acc_m: gps.acc_m,
    sender_kind: cls.sender.kind,
    sender_id: cls.sender.id,
    sender_label: cls.sender.label,
    sender_role: cls.sender.role || null,
    channel_name: cls.channel,
    is_direct: cls.isDirect,
    hops: cls.hops,
    packet_type: cls.packetType,
  }
}
