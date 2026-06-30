// Zero-hop CONTROL/DISCOVER_REQ — makes nearby nodes reply directly (corescope-rx).
export const CMD_SEND_CONTROL_DATA = 0x37
export const CTRL_NODE_DISCOVER_REQ = 0x80  // sub_type 0x8 in the upper nibble
export const DISCOVER_PREFIX_ONLY = 0x01    // responders send an 8-byte pubkey prefix
export const DISCOVER_FILTER_ALL = 0xff     // type_filter: all ADV_TYPE_* bits

// tag = 4-byte Uint8Array (random; reflected in each DISCOVER_RESP).
export function buildDiscoverFrame(tag) {
  return new Uint8Array([CMD_SEND_CONTROL_DATA, CTRL_NODE_DISCOVER_REQ | DISCOVER_PREFIX_ONLY, DISCOVER_FILTER_ALL, ...tag])
}
