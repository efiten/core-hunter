import { bytesToHex } from './decode.js'
import { isUsableFix } from './gps.js'

// A reception is captured when it can be placed: a fix good enough to put it
// on the map (#274). Once a reception is binned into the hex grid there is no
// way to un-see it, so a poor fix is refused here rather than filtered
// downstream.
//
// Attribution is NOT a condition (#454). Three kinds can never be attributed --
// a TRACE packet (its path bytes are SNR values, not hop hashes), a relayed
// packet on a DIRECT route, and a FLOOD packet whose last path hash is one byte
// -- and refusing them threw away an RSSI, an SNR and a fix our own radio
// produced, because the name on top was missing. That is the wrong half to
// drop: the measurement is the part nobody can forge, the identity is the part
// the protocol never authenticated. A reception with no sender says something
// transmitted here, this strongly, without claiming who; classifyReception
// leaves its sender null and every identity surface refuses it from there.
export function shouldCapture(cls, fix) {
  return !!cls && isUsableFix(fix)
}

export function buildRecord(frame, cls, gps, nowIso, rxPubkey = '') {
  return {
    rx_at: nowIso,
    // Stamped at capture, not supplied at publish time (#454). A queued
    // reception was heard by a particular companion, and that fact does not
    // stop being true when the radio is unplugged -- but the pubkey used to
    // come from live state, which a deliberate disconnect clears, so a backlog
    // became unpublishable the moment someone tidied up. It also binds each row
    // to the companion that actually heard it, so swapping companions cannot
    // republish an old backlog under a new identity.
    rx_pubkey: String(rxPubkey || ''),
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
