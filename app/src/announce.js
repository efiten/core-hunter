// Share my node name (#576): the one frame that puts the hunter's own identity
// on air. The companion sends its self-advert: its public key and name, plus a
// position only if its owner set the location policy in the MeshCore app; this
// module adds nothing to it. Off by default, and it rides the auto-ping cycle
// only while a selected target is a companion, the node that has to hear us.
//
// Why it exists: MeshCore firmware answers a request only from a sender it can
// look up in its contact list (src/Mesh.cpp:150-156, the shared secret comes
// from the contact), and a node adds us to that list when it hears our advert
// (src/helpers/BaseChatMesh.cpp:151-176). Without it, #553's telemetry request
// reaches a companion that cannot decrypt it.

// examples/companion_radio/MyMesh.cpp:1250-1268. Byte 1 selects the route:
// 1 = flood, 0 (or absent) = zero hop. Always 0 here: the advert is for the
// nodes that can hear us directly, which are the ones we can hunt.
export const CMD_SEND_SELF_ADVERT = 7
export const ADVERT_ZERO_HOP = 0

export function buildSelfAdvertFrame() {
  return Uint8Array.from([CMD_SEND_SELF_ADVERT, ADVERT_ZERO_HOP])
}

// announceThisCycle: does this auto-ping cycle carry the advert? Only with the
// setting explicitly on, a companion to send it through, and at least one
// selected target that needs it (selectedCompanionIds). Anything but an exact
// true is off, since off is the default this setting protects.
export function announceThisCycle({ shareName, connected, companionTargets } = {}) {
  return shareName === true && connected === true && (Number(companionTargets) || 0) > 0
}
