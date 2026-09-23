# The reading layer: the HUD rows (#637, #618)

**Date:** 2026-09-15
**Status:** decided (Kasper, 14 and 15 September 2026, on the approved artboard), implemented
**Related:** #555 (the tools row and the float readout), #453 (the HUD is the ticker's playhead), #454 (the backlog), #452 and #661 (the guess mark and the attribution the sender line prints), #660 (the direction arrow, which takes a slot in row 1), #264 (the FAB clearance)

## What changed

The HUD's readout was one row: RSSI with its unit, SNR, the sender, the age and the backlog. At
360 px a long relay name took the space the SNR needed, so the SNR was cut to `SNR -1...` (#637),
and a visible backlog wrapped inside the row and grew the HUD over the FAB rail.

It is two rows now, above the unchanged tools row:

1. **The reading.** The RSSI as a number in its tier colour, without a unit (the float keeps
   `dBm`), the SNR, and the age at the right edge. The SNR never shrinks.
2. **The sender line.** `via ` and the guess mark `~` muted, the name in the text colour and cut
   from its end, and the backlog pill at the right end of the row.

Both rows have a fixed height (38 px and 20 px), so nothing a row shows can change the HUD's
height. That includes the direction arrow (#660), which goes before the number in row 1.

## Empty states

No slot holds a placeholder dash any more.

- **Before the first reception** the RSSI, the SNR and the age are empty, and the sender line reads
  `No reception yet`, muted. That state is in `index.html`, so a slow `config.json` or module shows
  it from the first frame rather than two blank rows.
- **A reception without a sender id** says what was heard, in the packet-type words the ticker's
  meta cell uses: `Trace, no sender id`, `Unknown, no sender id` for a packet that did not decode,
  and `No sender id` when there is no type either. Muted, like the empty line.

`senderReadout` (`app/src/hudsender.js`) returns the line as `text` and in the parts the HUD draws:
`prefix` (`via ` and the mark), `name`, and `note` for the two cases above. `nameParts`
(`app/src/names.js`) splits the guess mark from the name; `displayName` joins the two, so every
other surface prints what it printed before. The HUD builds the line with `textContent` only: the
name comes from a registry.

## The backlog pill

`N queued · not connected` and `N queued · not on the map yet` (#454) are a pill with a border and
text in `--ch-accent-2`, on a transparent ground. The warn level used `--ch-sig-mid` and the alarm
level `--ch-sig-hot`; the signal tiers are for readings only (`docs/design-system.md`), and a
backlog is the app's state. The alarm level keeps only its weight.

## Measured

Headless Chromium on macOS (SF Mono), the real app with its own markup, stylesheet and HUD code,
at 360x740 and 412x915, in light and dark.

| | 360 px | 412 px |
|---|---|---|
| Row 1 with `-120`, `SNR -20.0 dB`, `59m 59s` and a 30 px arrow stand-in | no overflow, SNR whole | no overflow, SNR whole |
| Row heights | 38 and 20 | 38 and 20 |
| Pill `312 queued · not connected` | 188 px, sender keeps 132 px | sender keeps 184 px |
| Pill `3,005 queued · not on the map yet` | 235 px, sender keeps 85 px (`via ~NL-...`) | sender keeps 137 px |
| HUD height, hunting and at the gate | 114.4 and 113 px | 114.4 and 113 px |
| Clearance to `#layer-toggle` | 32 and 33 px | 32 and 33 px |

In every case the pill is whole and `via ~` survives the cut. A note on the sender line (`No
reception yet`, `Trace, no sender id`) is cut from its end beside the pill the same way as a name.
The FAB offsets (146 to 362 px) stay: 32 px is above the 27 px #264 measured.

Before, on the same branch and the same probe: the empty HUD was 86.4 px. With the long relay name
the SNR was cut at both widths, and even `1 queued · not connected` wrapped inside the row (HUD
115.9 px, 30 px clearance). The widest backlog took the HUD to 160.5 px, 14 px over
`#layer-toggle`, at both widths.

Not measured: Android falls back to its own monospace font, so the fit at 360 px is unverified on
a phone.

## The HUD with the ticker closed

The HUD shows the reception on the ticker's playhead (#453). Before #652 a closed ticker put the
oldest reception in its list on the HUD: a closed card is `display: none`, so its list reads
`scrollTop` 0, and the playhead was read from the scroll position. #652 keeps the row on the
playhead explicitly, the newest while the ticker follows, so the HUD follows the newest reception
with the ticker closed or open. The HUD rows here do not change that.

## The float readout (#615)

Android cuts a 16:9 window for a video: 548x308 and 505x284 device px on a 1080px phone. The 4:3
canvas filled 75% of that width and left a band on each side, so the canvas is 1067x600 now, at
the same text sizes. The sender line holds about 25 characters instead of 18.

- **Always dark.** The window hangs over other apps, often a dark navigation app, and a cream
  window over one reads badly. The canvas and the video carry `data-theme="dark"`, which
  `tokens.css` declares on any element, and the colours are read from the canvas. No token of its
  own; the fullscreen bars stay `--ch-bg`, now the dark one.
- **The reading.** A 28px tier bar, the RSSI at 190px in its tier colour with a muted `dBm`, SNR left
  and age right on one line. Numbers are never cut.
- **The sender line.** The HUD's `senderReadout` parts: `via ~` muted and whole, the name in the
  text colour cut from its end by whole graphemes (`fitName`), so an emoji is never split. A
  reception without a sender shows the note, muted.
- **The footer.** The stand in the HUD's word, `Filtered` or `All`, with the HUD's closed eye when
  the filter kept receptions off; `Disconnected` in `--ch-accent-2` when BLE is gone; `BLE` and
  `MQTT` by name on the right, with a filled `--ch-accent` dot when up and a hollow `--ch-accent-2`
  one when down.
- **Before the first reception** the window reads `No reception yet` and `The reading appears here
  when a packet comes in.`

`floatModel` and `fitName` are unit-tested; the drawing is canvas glue, checked by drawing the real
canvas for six states with the app in its light theme.

## How the float readout leaves the page (#616)

The float button promises a floating window, so that is what it asks for first, except on Android.

1. **Picture-in-picture**, where `document.pictureInPictureEnabled` says the API is on. A video with
   the method alone does not count as a way out (`floatSupported`).
2. **Fullscreen** otherwise, with `screen.orientation.lock('portrait')` once fullscreen is up, since a
   lock is only allowed then. The 16:9 canvas would turn the phone sideways without it. A refused
   lock still leaves the readout out. The lock is released as soon as fullscreen ends, and the
   600 ms wait for Android's fullscreen-to-window hand-over stays as it was.

**On Android the two swap places (#669).** #616 took Android Chrome's API to be off. In the field
(21 September) the window opened without the fullscreen step, the sound parked and GPS logging
stopped: the page was hidden while the window was up, and a reception without a fix is not recorded.
Through fullscreen and Home, Chrome shrinks itself into the window and the page stays visible.
`fullscreenFirst(navigator)` answers by platform, because the capability flags match desktop
Chrome's. Picture-in-picture is still the fallback when fullscreen is refused.

3. **The video's own player** (`webkitEnterFullscreen`) on iPhone Safari, which has no element
   fullscreen.

The reading goes in with the tap: the canvas draws it before any window is asked for, because a
window shows the canvas's current frame the moment it opens. A second tap while the first is still
asking gets the same attempt. When every path is refused the button does not say the readout is
out, and the stream stops.

The order, the lock timing, the hand-over, the refusals and the in-flight guard are unit-tested
against fakes of the video, its document and `screen.orientation`. Field test on an Android phone
(Kasper, 21 September, #669): fullscreen opens upright, the window appears after Home, GPS keeps
logging and the sound keeps playing. Not verified: whether a refused request uses up the tap the
next one needs.

## The direction arrow (#660)

An arrow toward the sender of the shown reception, so a hunter can steer and see whether they are
closing in without looking at the map. The problem it answers is steering, not understanding the
last hop, so it gives a direction and no distance.

- **Where it points.** The last hop: the originator at zero hops, a flood's last relay otherwise.
  A reception placed on a node by reach (#661) points at that node's advertised position, and a
  collision points nowhere. Otherwise the registry's position for the id (an advert's whole key, a
  Discover, trace or telemetry reply's unique prefix), and without one the estimate over the
  receptions of that id in the plot window that fall under rule 2. A channel name is not a node
  and has no arrow. Filled for an advertised position, outlined for an estimate (`arrow.js`).
- **What it turns against.** Where you are heading, not north: the GPS course from 2 m/s and the
  compass below that, switched with the same hysteresis as the map's heading mode (`autoSource`).
  The arrow keeps its own heading, whatever the map's compass button is set to. A compass reading
  counts for 2 s. On iOS the orientation events need a permission prompt, which the arrow never
  raises: below 2 m/s it has a compass there only once the compass button got a yes.
- **When there is none.** No position, no heading, no GPS fix in the last 15 s (the watch's own
  timeout, `GPS_STALE_MS`), or a collision: no arrow and nothing in its place.
- **HUD.** A 30 px box before the RSSI number in the 38 px row, in the number's tier colour. The
  row keeps its height with or without it; the number moves over by the box and the gap. It
  repaints from a 1 degree turn.
- **Float readout.** Top right, beside the number, 84 px, no ring. The canvas redraws from a
  5 degree turn, or when the arrow appears, goes or changes kind.

The HUD's closed eye on the stand pill never appeared: `hidden` is not a property of an SVG
element, so setting it did nothing. It is toggled as an attribute now, and so is the arrow's box.

Measured with the real app and a steered GPS: an estimate 2 km east, heading east at 10 m/s, the
arrow points straight ahead; heading north, to the right; 17 s after the fixes stop it is gone. The
HUD stays 114 px throughout. Not verified: a real compass, a real phone in picture-in-picture
(where the page is hidden and GPS and orientation events may stop, which the age gates turn into
no arrow rather than a frozen one), and the bearing swinging close to the target.

