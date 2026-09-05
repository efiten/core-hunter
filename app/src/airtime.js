// LoRa time-on-air for the frames auto-discover sends, and the silence a
// cycle has to buy afterwards (#381).
//
// AGENTS.md §7: the numbers here are the firmware's, not ours.
//
//   Preset. The firmware's default build flags (platformio.ini, [arduino_base])
//   are LORA_FREQ=869.618, LORA_BW=62.5, LORA_SF=8, and LORA_CR defaults to 5
//   (variants/*/target.cpp, #ifndef-guarded). The app reads the SF back from
//   PACKET_SELF_INFO byte 56 (selfinfo.js); it cannot read the bandwidth or
//   the frequency, so 62.5 kHz is assumed and an unknown SF reads as 8.
//
//   Preamble. src/helpers/radiolib/RadioLibWrappers.h:
//     static uint16_t preambleLengthForSF(uint8_t sf) { return sf <= 8 ? 32 : 16; }
//
//   Formula. The firmware's getEstAirtimeFor() is RadioLib's getTimeOnAir(),
//   ported below in the same integer arithmetic (explicit header, CRC on).
//
//   Frame sizes, from Packet.cpp getRawLength() = 2 + path bytes + payload:
//     Discover request: header, path_len, 6 payload bytes (discover.js) = 8
//     Trace-ping:       header, path_len, 1 path byte, 9 payload bytes
//                       (Mesh.cpp createTrace: tag 4, auth 4, flags 1) = 12
//
//   Budget. 869.618 MHz sits in the 869.400 to 869.650 MHz sub-band, which
//   ERC 70-03 limits to a 10% duty cycle. The app cannot read the frequency,
//   so this is a stated assumption for the default preset rather than a
//   reading, and it is not a setting: the default is the decision.
export const DUTY_BUDGET = 0.1
export const DEFAULT_SF = 8
export const BW_KHZ = 62.5
export const DISCOVER_BYTES = 8
export const TRACE_BYTES = 12

export function preambleSymbols(sf) {
  return sf <= 8 ? 32 : 16
}

function knownSf(sf) {
  const n = Number(sf)
  return Number.isInteger(n) && n >= 5 && n <= 12 ? n : DEFAULT_SF
}

// Whole milliseconds on air for one frame of `bytes`, at spreading factor
// `sf` and coding rate 4/5. RadioLib SX126x::getTimeOnAir, step for step.
export function frameAirtimeMs(bytes, { sf, bwKhz = BW_KHZ } = {}) {
  const s = knownSf(sf)
  const symbolUs = Math.floor((10000 * 2 ** s) / (bwKhz * 10))
  const sfCoeff1x4 = s <= 6 ? 25 : 17
  const sfCoeff2 = s <= 6 ? 0 : 8
  const sfDivisor = symbolUs >= 16000 ? 4 * (s - 2) : 4 * s
  const bits = Math.max(0, 8 * Math.max(0, Number(bytes) || 0) + 16 - 4 * s + sfCoeff2 + 20)
  const codedGroups = Math.ceil(bits / sfDivisor)
  const symbolsX4 = (preambleSymbols(s) + 8) * 4 + sfCoeff1x4 + codedGroups * 5 * 4
  return Math.floor((symbolUs * symbolsX4) / 4 / 1000)
}

export function cycleAirtimeMs(frameBytes, sf) {
  return (frameBytes || []).reduce((sum, b) => sum + frameAirtimeMs(b, { sf }), 0)
}

// The period the cycle that sent these frames has to be followed by, so the
// radio stays inside DUTY_BUDGET. autoping.js takes it as minPeriodMs.
export function minPeriodMs(frameBytes, sf) {
  return Math.round(cycleAirtimeMs(frameBytes, sf) / DUTY_BUDGET)
}
