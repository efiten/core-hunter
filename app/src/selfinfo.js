// SELF_INFO handshake: send CMD_APP_START (0x01) and parse the PACKET_SELF_INFO
// (0x05) reply to learn the companion's own pubkey (and name). Source of truth:
// firmware/docs/companion_protocol.md.
import { bytesToHex } from './meshpacket.js';

const CMD_APP_START = 0x01;
const RESP_SELF_INFO = 0x05;

// requestSelfInfo resolves { pubkey, name } from the connected companion.
export function requestSelfInfo(transport, appName = 'coredrive-rx', timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const onFrame = (dv) => {
      const b = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      if (b[0] !== RESP_SELF_INFO) return;
      cleanup();
      const info = parseSelfInfo(b);
      info ? resolve(info) : reject(new Error('malformed SELF_INFO'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('SELF_INFO timeout')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); transport.offFrame(onFrame); }

    transport.onFrame(onFrame);
    // APP_START frame: [0x01][7 reserved bytes][app name UTF-8]
    const name = new TextEncoder().encode(appName);
    const frame = new Uint8Array(8 + name.length);
    frame[0] = CMD_APP_START;
    frame.set(name, 8);
    transport.send(frame).catch((e) => { cleanup(); reject(e); });
  });
}

const CMD_DEVICE_QUERY = 0x16;   // [0x16, 0x03] -> RESP_CODE_DEVICE_INFO
const RESP_DEVICE_INFO = 0x0d;
const CMD_SET_PATH_HASH_MODE = 0x3d; // [0x3D, 0x00, mode]  (mode 0=1B,1=2B,2=3B)

// requestDeviceInfo resolves { fwVer, pathHashMode } from the companion.
// pathHashMode is at DEVICE_INFO byte 81 (firmware v10+); null if absent.
export function requestDeviceInfo(transport, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const onFrame = (dv) => {
      const b = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      if (b[0] !== RESP_DEVICE_INFO) return;
      cleanup();
      resolve({ fwVer: b[1], pathHashMode: b.length > 81 ? b[81] : null });
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('DEVICE_INFO timeout')); }, timeoutMs);
    function cleanup() { clearTimeout(timer); transport.offFrame(onFrame); }
    transport.onFrame(onFrame);
    transport.send(new Uint8Array([CMD_DEVICE_QUERY, 0x03])).catch((e) => { cleanup(); reject(e); });
  });
}

// setPathHashMode sets the companion's advert path-hash size (1=2-byte). Fire-and-forget.
export function setPathHashMode(transport, mode) {
  return transport.send(new Uint8Array([CMD_SET_PATH_HASH_MODE, 0x00, mode]));
}

// parseSelfInfo: pubkey at bytes 4-35 (32 bytes), the radio at a fixed offset
// before the variable-length name, and the device name at bytes 58+. Layout
// from the out_frame construction in examples/companion_radio/MyMesh.cpp
// (CMD_APP_START handler) and the firmware's docs/companion_protocol.md: after
// byte 47, `freq = _prefs.freq * 1000` as uint32 little-endian (kHz) at 48-51,
// `bw = _prefs.bw * 1000` as uint32 little-endian (Hz) at 52-55, the spreading
// factor at 56 and the coding rate at 57 (#650). Each value is range-checked
// against what a LoRa radio can be set to and is null otherwise, so a short or
// older frame leaves it unknown rather than guessed (AGENTS.md §7): the SF picks
// the name resolvers, the rest feeds the duty floor (#609).
//
// The bounds are the firmware's own clamps (MyMesh.cpp, "sanitise bad pref
// values"): frequency 150 to 2500 MHz, bandwidth 7.8 to 500 kHz, coding rate
// 5 to 8 (the denominator of 4/n). The bandwidth is a float there and is sent
// as `bw * 1000`, so 10.4 kHz arrives as 10399 or 10400: a range, not the
// list of SX126x steps, and a little under 7800 to take the float's word.
const inRange = (v, lo, hi) => (v != null && v >= lo && v <= hi ? v : null);
export function parseSelfInfo(b) {
  if (b.length < 36) return null;
  const pubkey = bytesToHex(b.slice(4, 36));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const freqKhz = b.length > 51 ? inRange(dv.getUint32(48, true), 150000, 2500000) : null;
  const bwHz = b.length > 55 ? inRange(dv.getUint32(52, true), 7790, 500000) : null;
  // LoRa spreading factor is 6–12; treat anything else (or a short frame) as unknown.
  const sf = b.length > 56 ? inRange(b[56], 6, 12) : null;
  const cr = b.length > 57 ? inRange(b[57], 5, 8) : null;
  let name = '';
  if (b.length > 58) {
    try { name = new TextDecoder().decode(b.slice(58)).replace(/\0+$/, ''); } catch (e) { name = ''; }
  }
  return { pubkey, name, sf, freqKhz, bwHz, cr };
}

// radioSummary is the Status tab's line for the radio: what the companion
// reports, in the units a hunter reads, and only what it reports. A value the
// frame did not carry is left out rather than shown as a preset.
export function radioSummary(info) {
  if (!info) return '—';
  const parts = [];
  if (info.sf) parts.push('SF' + info.sf);
  if (info.freqKhz) parts.push(String(info.freqKhz / 1000) + ' MHz');
  if (info.bwHz) parts.push(String(info.bwHz / 1000) + ' kHz');
  if (info.cr) parts.push('CR 4/' + info.cr);
  return parts.length ? parts.join(' · ') : '—';
}
