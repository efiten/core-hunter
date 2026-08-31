# Design system

One system across all three surfaces: the RX app (`app/`), the analyser map (`web/`) and the
landing page (`landing/`).

**The rule.** A pattern is defined once and applied everywhere it fits. A difference between
surfaces is allowed only when it is *functional*, and then it is written down here as a rule
about the **surface**, not as an exception for one component. Anything new on that surface
follows the same rule.

**Everything here is a standard SaaS pattern.** Nothing on these surfaces is invented. Each
control below names the mainstream pattern it is an instance of, and that naming is the test: if
a proposal cannot be named as one, it is bespoke, and bespoke is how a product ends up with
three ways to do the same thing. Simple beats clever; a pattern a user has already met somewhere
else needs no explaining.

**Why this file exists.** The patterns below were each decided once, and then re-derived,
half-applied or quietly dropped when the next component was built. That put the job of spotting
drift on the person reviewing, which is not where it belongs. This is the register; the guards
named under each item are what keep it true without anyone remembering.

---

## Tokens

`app/src/styles/tokens.css` is the source. `web/style.css` and `landing/` declare the same names
with the same values. Nothing hardcodes a colour that a token already names.

| group | names |
|---|---|
| surface | `--ch-bg`, `--ch-surface`, `--ch-surface-thin`, `--ch-border`, `--ch-input-bg` |
| type | `--ch-text`, `--ch-muted` |
| accent | `--ch-accent` (primary), `--ch-accent-2` (alerts) |
| signal tiers | `--ch-sig-hot` / `-warm` / `-mid` / `-cool` / `-cold` / `-faint` / `-none` |
| layout | `--ch-rx-line-h` (ticker row pitch), `--ch-bar-h` (map bar height) |

Both themes are declared for every token. `--ch-basemap` is a hint, not a colour.

**Signal tiers are for readings, never for UI state.** A selected chip is `--ch-accent`, not
`--ch-sig-cool`. That confusion is what #225 fixed on the map.

**Guard:** `web/parity.test.js` pins that `--ch-rx-line-h` and `--ch-surface-thin` are declared
on `:root` on both surfaces with the same values.

---

## Controls

### One control that swaps state, not two mirrored ones

*Standard pattern: stateful toggle button (Play/Pause, Follow/Following).*

Where two actions are mutually exclusive, use one element whose label, style and handler change
with the state. Not two elements toggled with `hidden`.

Applied by: the connect button's four states (`app/src/connectstate.js`, #433), the ticker's
collapse chevron (#560/#424), the sound and view FABs.

### A control offers only what would change something

*Standard pattern: disable or omit a no-op action, rather than letting a press do nothing.*

A stop, tab or option that leaves the screen as it is must not be offered: the press reads as
broken. The ticker's collapse cycle is computed per reception count for exactly this reason
(`collapseLevels`), because a three-lane stop on a three-lane card does nothing.

### Three or more states: a segmented control

*Standard pattern: segmented control (iOS/macOS), the same thing as a radio group styled as one
strip.*

Not a checkbox, and not a cycle button, where the states are named and simultaneously
meaningful. Theme is `System / Dark / Light` (#563); the map's layer mode is
`Points / Hex / Both`.

### Pick several: the browsable checkbox-row popover

*Standard pattern: multi-select listbox in a popover, as GitHub's label picker and every
filter menu in a modern admin UI does it.*

A toggle button opening a panel of clickable rows with checkbox state, lazy paging, outside-click
and Escape to close (`web/targetpicker.js`, #223). Never a native `<select multiple>`, never a
one-off widget.

### Hit areas are at least 44px

*Standard pattern: the platform touch-target minimum (Apple HIG 44pt, Material 48dp).*

The glyph keeps its size; an `::after` extension carries the touch box. The one deliberate
exception is the app's node markers at 30px: a marker swallows the pan gesture that starts on
it, so 33 markers at 44px would turn a dense cluster into a patch of map that cannot be dragged
(#539).

### Native form controls take the accent

`accent-color: var(--ch-accent)` on `:root`. A checkbox is still a checkbox where the value is a
boolean; it just is not browser-blue (#563).

---

## Panels over the map

*Standard pattern: a floating panel, the palette or inspector every map and design tool has,
with the window-chrome affordances that come with it.*

Both surfaces float panels over a map, and they share the card: `--ch-surface-thin` with a
`blur(10px)` backdrop, `1px solid var(--ch-border)`, `10px` radius, and a soft drop shadow.
Text over a map without a plate is unreadable, which was F3 of the 26 August review.

### Surface rule: on the map, a floating panel is draggable, closable and collapsible

The map is a desktop-first surface where the content is in the middle, so anything floating over
it must be movable out of the way, shrinkable and dismissible. This is a property of the
**surface**, not of the ticker: the next interaction popup added to `web/` gets the same three.

Dragging is a desktop affordance and does not come to the app, which is used one-handed while
driving and keeps its panels in fixed positions.

### Surface rule: on the map, a floating panel passes pointer events through

`pointer-events: none` on the container, re-enabled only on the rows and the header. The panel
must not swallow the drag, wheel or click that Leaflet needs (#287, #322). The app's cards catch
their own events; there is no map gesture underneath them to protect.

---

## The receptions ticker

*Standard pattern: a live log tail (a console or activity feed), newest at the bottom, following
until the reader scrolls back.*

One component on two surfaces (`app/src/receptionlog.js`, `web/receptionticker.js`). Same card,
same header, same rows, same geometry:

- **Height follows content**, in steps: header only, 1 lane, 3, 5, 10 (#560).
- **The newest reception sits on the bottom lane** at every size, with nothing padding the list
  below it.
- **The playhead stays two thirds down**, so lines roll through it with newer receptions below.
- **The fade** spans the lanes on each side of the playhead and stops at `RX_FADE_FLOOR`, so no
  row the card has made room for is invisible.

**Guard:** `web/parity.test.js` compares the geometry by *running* both modules over every count
from 0 to 60, and compares the `.rx-hd`, `.rx-list`, `.rx-ln`, `.rx-tm`, `.rx-rs` and `.rx-gt`
rules declaration by declaration.

### Deliberate differences, and why

| | app | map | reason |
|---|---|---|---|
| position | fixed, centred | placed, draggable | surface rule above |
| pointer events | caught | passed through | surface rule above |
| put away | ✕, reopened from a top-bar button | last collapse stop, the header alone | the map has no top-bar button to travel to; #561 is a design round over that bar |
| collapse stops | 3 lanes, 1 lane | 3 lanes, 1 lane, header | the extra stop is the map's "away" |

---

## Copy and marks

- **One brand mark**, the PWA icon (`app/public/icon.svg`), on every surface (#539).
- **Drawn icons, not emoji.** An emoji renders differently per platform and cannot take a token
  colour.
- **One link colour**, `--ch-accent-2`, on all three surfaces (F17).
- **Product text** follows `schrijfrichtlijnen.md` §9: plain language, no magic, explicit,
  consistent. No em dashes.

---

## Open, not yet decided

- The fade floor is one number for both themes. Measured on the map at 1180px: the faintest row
  reads at contrast 1.90 on dark and 1.56 on light, so light falls further back. Equalising would
  need roughly 0.31 there.
- The map's top bar has no product name and its second row is four unrelated readouts (#561).
  A design round is pending; until it lands, nothing new should be added to that bar.
