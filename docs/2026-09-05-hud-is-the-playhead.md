# The HUD is the ticker's playhead (#453)

**Date:** 2026-09-05
**Status:** decided (Kasper, 2026-09-05), implemented
**Related:** #555 (the HUD follows the ticker's stand, and the float readout scrubs the playhead), #309 (the split this replaces), #451 (what identity a surface may claim)

## What changed

The HUD's sender line was written once, at capture, before the resolver had answered. The ticker
rebuilds from enriched rows every tick, so one packet read `repeater_3_` there and `via 2beb` on
the HUD for as long as it stayed on screen.

The narrow fix, redrawing the line when the name lands, kept a model with two readouts: the HUD
showed the last reception, the ticker's playhead could be scrubbed away from it, and since #555
the float readout followed the playhead while the HUD did not. Kasper's call: one readout. The
HUD shows the reception on the ticker's playhead, the float shows the same, and the
previous/next buttons on the float window move all three.

- **A reception that passes the filter goes on the HUD**, at capture, before the tick, as it
  always did. If a scrub had moved the playhead, this puts the ticker back on the newest row
  first: the HUD shares its playhead, so the two cannot disagree (Kasper, 2026-09-05: new
  receptions reach the HUD, within the filter).
- **Scrubbed** (a tapped row, a step off the newest row, a marker tap): the HUD shows that row,
  with that reception's own age, until the next matching reception arrives or you scroll back to
  the newest row.
- **Every tick**, the row on the playhead comes fresh from IndexedDB and enriched. When it reads
  differently from what the HUD shows (`sameReadout`, `app/src/hudmode.js`: same reception, same
  sender line), the HUD is redrawn from it. That is how a name that resolved later reaches the
  HUD, through `senderReadout` like every other draw, so the `#` on a hash id stays.
- **Flipping the stand** (filtered/all) rebuilds the ticker and follows again; the HUD moves with
  the playhead, so flipping to All still shows the last capture at once.

## Why one readout

Two readouts that agree while following and drift as soon as you scrub is the worst of both: the
PiP window already moved with the playhead (#555), the HUD under the same thumb did not. A
readout that is the playhead has one answer to "what am I looking at", and the name question
disappears with it, because the playhead row is the enriched one.

## Left out

- The hidden count while scrubbed: a scrubbed playhead is a choice, not something the filter kept
  off, so the count only shows while following.
- A scrub that survives new receptions. Looking back is momentary by design: the readout is for
  what you hear now, and the ticker's list is where the history stays.
