# The HUD follows the filter, and acts on what it shows (#555)

**Date:** 2026-09-04
**Status:** decided (Kasper, 2026-09-04), implemented
**Related:** #453 (the HUD name frozen at capture time, stays open), #301 (sound while hidden, unchanged), #408 (native PiP)

## What changed

The HUD used to be written from every capture, before the filter ran (`app.js`, the
`updateHud(rec)` call in the capture path). Narrow the map to one target and the readout still
jumped to every passer-by on the public channel.

It now follows the same **filtered / all** stand as the receptions ticker. There is one stand,
`state.rxMode`, and the ticker's header toggle and the HUD's `Filtered`/`All` pill both flip it.
With a filter set you look at the filtered set on both surfaces; with no filter set the two
stands show the same thing.

- **Filtered:** a reception the filter would keep off the map stays off the HUD. The HUD keeps
  the last reception the filter let through, with that reception's own RSSI, SNR, sender and
  age. A closed eye on the pill says the filter has kept something out since then; the count is
  in the pill's `aria-label` and tooltip, not on the row.
- **All:** every capture reaches the HUD, which is what it did before. Flipping to All puts the
  last capture on the HUD at once if the filter had kept it off.
- **Quick actions** on the shown sender: `Target` (only this one, the map popup's Isolate),
  `+ Target` (add to the selection) and `Ignore`. They dispatch the same `hunt:isolate-sender`
  and `hunt:ignore-sender` events the popup and the target sheet use. Target and + Target
  follow the target list's own rule (`isTargetKind`): a 1-byte hash cannot be a target. Ignore
  only needs an id.

## Why one stand and not two

The first cut had a HUD-only toggle, persisted like the sound mode. Kasper's steer: "als je een
filter hebt ingesteld kijk je altijd naar filtered, net als bij de ticker. dus de switch in de
ticker of hud is bij beide dan van toepassing." Two toggles for one question would let the
ticker and the HUD disagree about which set you are looking at, on the same screen.

The stand is session-only, as the ticker's was. The app opens on filtered.

## Why the whole readout follows, not only the name

The issue text said "the sender line gets a toggle". If only the name followed the stand, a
passer-by's RSSI would sit next to the target's name: one reception, two identities, the class
of defect #453 describes. So a reception either replaces everything on the HUD or nothing.

## What stays as it was

- `updateHud` still renders from the capture-time record. #453 (re-render once a name resolves)
  is separate and stays open.
- Sound: every capture is still cued regardless of the filter (#468). The HUD stand is a display
  choice, and audio is not a display.
- The FAB stack moved up by the height of the new row (34 px), so the clearance above the HUD
  is what #264 measured.

## Layout

One row of pills under the readout. Measured in the browser: 308 px of 328 px at 360 px wide
with the widest labels (`Ignored`, `+ Target`), no wrap; 308 of 380 at 412 px.

## Left out

Picture-in-picture (the third half of #555) gets its own design round first.
