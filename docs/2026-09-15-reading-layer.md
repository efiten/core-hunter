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

## How the float readout leaves the page (#616)

The float button promises a floating window, so that is what it asks for first.

1. **Picture-in-picture**, where `document.pictureInPictureEnabled` says the API is on. Android
   Chrome's video has `requestPictureInPicture` with the API switched off, so there this step is
   skipped, and a video with the method alone no longer counts as a way out (`floatSupported`).
2. **Fullscreen** otherwise, with `screen.orientation.lock('portrait')` once fullscreen is up, since a
   lock is only allowed then. The 16:9 canvas would turn the phone sideways without it. A refused
   lock still leaves the readout out. The lock is released as soon as fullscreen ends, and the
   600 ms wait for Android's fullscreen-to-window hand-over stays as it was.
3. **The video's own player** (`webkitEnterFullscreen`) on iPhone Safari, which has no element
   fullscreen.

The reading goes in with the tap: the canvas draws it before any window is asked for, because a
window shows the canvas's current frame the moment it opens. A second tap while the first is still
asking gets the same attempt. When every path is refused the button does not say the readout is
out, and the stream stops.

The order, the lock timing, the hand-over, the refusals and the in-flight guard are unit-tested
against fakes of the video, its document and `screen.orientation`. Not verified: a real Android
phone, including whether Chrome's own rotation for fullscreen video or the portrait lock wins, and
whether a refused picture-in-picture request uses up the tap that fullscreen then needs.
