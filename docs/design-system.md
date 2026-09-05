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
| layout | `--ch-rx-line-h` (ticker row pitch), `--ch-rx-head-h` (its header), `--ch-bar-h` (map bar height) |

Both themes are declared for every token. `--ch-basemap` is a hint, not a colour.

**Signal tiers are for readings, never for UI state.** A selected chip is `--ch-accent`, not
`--ch-sig-cool`. That confusion is what #225 fixed on the map.

**Guard:** `web/parity.test.js` pins that `--ch-rx-line-h`, `--ch-rx-head-h` and `--ch-surface-thin`
are declared on `:root` on both surfaces with the same values. The two ticker ones together are
the card's geometry, which the map computes before the card exists, so a surface that misses one
does not lay out wrong -- it computes `NaN` and decides nothing.

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

### Hit areas are at least 44px, except where the target lies over the map

*Standard pattern: the platform touch-target minimum (Apple HIG 44pt, Material 48dp), with the
map-marker carve-out every map product makes.*

The glyph keeps its size; an `::after` extension carries the touch box.

A marker drawn **on** the map is the exception, and it is a rule rather than a one-off: the
target swallows the pan gesture that starts on it, so a dense cluster at 44px becomes a patch of
map that cannot be dragged. Those get 30px, which doubles the target without making the dead
zone dominant (#539). Anything in a bar, a panel or a sheet is 44px, because nothing is being
dragged underneath it.

### Two controls side by side cannot share a glyph family

*Standard pattern: an icon carries meaning only by being unlike the icons next to it.*

The receptions button and the menu sat next to each other in both bars drawing three horizontal
lines each, one set staggered and one set equal. At 20px, next to each other, that is two
hamburgers. The receptions button is a pulse now, because what it opens is a live feed.

The check is the bar, not the icon: an icon that reads fine on its own can still be wrong beside
the one that follows it.

### An affordance revealed by hover does not exist below the breakpoint

`matchMedia('(hover: hover)')` is false on a phone, so a control that appears on
`:hover` never appears there at all. Either give it a second, always-visible
form, or **drop the affordance entirely at that width** — but do not leave it
hit-testable and invisible, which is the worst of the three: a target nobody can
see that does something when pressed by accident.

The ticker's drag frame is two 6px strips shown on hover (#424), and dragging is
dropped below 640px rather than given a touch handle. Why is under **Panels**.

### Native form controls take the accent

`accent-color: var(--ch-accent)` on `:root`. A checkbox is still a checkbox where the value is a
boolean; it just is not browser-blue (#563).

---

## Panels

### Surface rule: the app uses sheets, the map uses floating panels

*Standard patterns: the bottom/edge sheet (mobile), and the floating panel or inspector (desktop
map and design tools).*

The app is used one-handed while driving, so its panels come from an edge, sit in fixed
positions and are dismissed the way a sheet is. The map is looked at on a desktop with the
content in the middle, so its panels float, move and stack. Both are ordinary patterns for their
surface; neither is converted to the other.

What does **not** differ is what is inside them: the card, the tokens, the controls and the copy
are the same on both.

### The card

*Standard pattern: a floating panel, the palette or inspector every map and design tool has,
with the window chrome that comes with it.*

Both surfaces float panels over a map, and they share the card: `--ch-surface-thin` with a
`blur(10px)` backdrop, `1px solid var(--ch-border)`, `10px` radius, and a soft drop shadow.
Text over a map without a plate is unreadable, which was F3 of the 26 August review.

### Surface rule: on the map, a floating panel gets out of the way

Anything floating over the map must be movable aside, shrinkable and dismissible. This is a
property of the **surface**, not of the ticker: the next interaction popup added to `web/` owes
the reader the same.

**How it moves aside is a width question, not a touch one.** Above 640px it drags. Below,
the card is full-bleed (`min(680px, 100vw)`), so every position is the same band at a different
height and there is no "out of the way" to drag it to — its stops and its cross are what move it
aside there, which is what the app does at every width (#561).

So dragging is the one of the three that comes neither to the app nor to a phone. Both for the
same reason: it only means something when there is map beside the panel as well as under it.

**Closing works the same on both:** a cross on the panel, and a button in the bar that brings it
back, in the same place on both surfaces. A panel that can be dismissed without a visible way
back is not dismissible, it is lost.

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
| position | fixed, centred | placed; dragged above 640px | surface rule above |
| pointer events | caught | passed through | surface rule above |

Everything else is the same, including the collapse stops and the cross with its bar button.
The map's bar carries a `#ticker-btn` for that, which the #561 round over that bar has to keep.

---

## The filter panel

*Standard pattern: the filter drawer — named groups, an active count on the trigger, and a
clear-all.*

**One panel on both surfaces** (`web/index.html`'s `#bar-filters`, `app/src/filtersheet.js`).
Same groups, same order, same words:

`Time` · `Traffic types` · `Sender id` · `Only show` · `Ignored senders`

The map adds `Overlays` and `View` **after** those, and only there: they are analysis, and the
map is the superset. Nothing else may differ, including the order — the app opened with two
checkboxes and reached the chips third while the map did the opposite, and one said `Types`
where the other said `Traffic types` (#564).

### The panel is the complete set

Everything that narrows the view is in it, at every width. A filter reachable only from
somewhere else is a filter the panel lies about: the map's ignore list lived in the settings
sheet, which is where you go to change how the app behaves, not what it shows.

The bar may carry a **shortcut** to a control the panel owns. Below 640px it carries none:
what does not fit moves into the panel (see **Bars**).

### "Everything" is one state, drawn as an All chip

*Standard pattern: the All/None chip every faceted filter has.*

A chip row's selection is a Set, and the empty Set means no filter on that dimension. That
state is drawn as an explicit `All` chip, lit, with nothing else lit. Picking a chip turns All
off; unpicking the last one turns it back on; pressing All clears the rest and is a no-op when
it is already on (a control offers only what would change something).

The map used to write the same state as *no chip lit* — right in the query it built, and
silent on screen. The rule is `nextChipSelection` in `chiprow.js`, and the All chip never
reaches a query string: it is a drawing of the empty set, not a value.

### The count says how much, the panel says what

The trigger carries the number of **dimensions** narrowed, not of chips: four active type
chips are one narrowed dimension, and clearing it is one act. `activeFilterCount` is the one
answer, and `Clear N filters` promises the same number the trigger shows.

That list is the panel's inventory and it does not maintain itself — a control added to the
panel stays uncounted until it is added there too (#497 shipped exactly that).

### Long chip rows collapse to six plus "+N more"

Fifteen 44px chips are four rows on a phone, and then the rest of the panel is under the fold.
**An active chip always shows, whatever its position:** a filter that is on and off screen is
the thing the panel exists to prevent. The count is computed from the list and the selection
(`hiddenChipCount`), not measured off the layout, so it is right before the first paint too.

**Guard:** `web/parity.test.js` pins `chiprow.js` and `barfilters.js` byte-identical between
`web/` and `app/src/`, and pins the two panels' group order against the markup each surface
actually renders.

## Bars

### One row, at every width

*Standard pattern: the application bar — brand left, controls in the middle,
account and overflow right.*

Both the app's `#topbar` and the map's `#bar` are one row that never wraps. A
wrapping bar is not a layout, it is whatever the flex flow produced: the map's
reached two rows at 1440 and **seven at 375**, 28% of the viewport, with four of
those rows carrying no control at all (#561).

`flex-wrap: nowrap` is load-bearing rather than cosmetic on the map. `#map`'s
top is measured once (#405), so a bar that grows after that measurement hides
the map underneath it: 111px of it as a guest at 375, with both of Leaflet's
zoom buttons inside the dead strip. A bar that cannot wrap cannot grow.

### What does not fit MOVES; it is never hidden or copied

*Standard pattern: the overflow menu.*

Below 640px the map's bar keeps the mark, two segments of the connected group
(`Select target`, `Filters`) and the icon buttons — the same two the app's group
has carried at that width since #305. Everything else moves: what narrows the
view into the filter panel, what acts into the menu (`web/barnarrow.js`).

Moved, for two reasons that are the same reason. One filter is one control: a
second copy is two things to keep in step and two places to read the state from.
And a hidden control has no box, so `placePopover` — which measures the toggle
(#372, #385) — has nothing to anchor to.

A control that moves closes its popover on the way. Leaving it open anchors it
to where the control used to be, and its toggle goes on claiming
`aria-expanded="true"` from inside a shut panel.

**Guard:** `e2e/barlayout.spec.js` asserts one centre line at 375, 768 and 1280
as a guest, that `--ch-bar-h` agrees with the bar's real height, where each
moved control ends up, that each exists exactly once, and that the order comes
back when the window grows.

### Notices and readouts are not controls

They describe the map, so they sit on the map, not in the bar's flow. In the bar
they took part in the same layout as the filters: "you now have admin access"
pushed the controls around, and four unrelated readouts landed on three
different baselines (#561).

They also may not take the corner a map control is in. The notice moved out of
the bar and straight over Leaflet's zoom control, which is the same defect in a
new place — `elementFromPoint` on the `+` returned `#guest-notice`. Overlays
clear the controls, and on a phone the zoom control moves to the bottom left,
where the ticker is not and a thumb is.

## Copy and marks

- **One brand mark**, the PWA icon (`app/public/icon.svg`), on every surface
  (#539), drawn inline so its strokes take `--ch-accent` and the signal tiers
  rather than the file's fixed palette. **Every surface names the product**:
  mark plus wordmark on a wide screen, the mark alone below 640px with the name
  in the menu, which is what a mobile app bar does. The map had neither until
  #561, and the map is the surface people are sent a link to.
- **Drawn icons, not emoji.** An emoji renders differently per platform and cannot take a token
  colour.
- **One link colour**, `--ch-accent-2`, on all three surfaces (F17).
- **Product text** follows `schrijfrichtlijnen.md` §9: plain language, no magic, explicit,
  consistent. No em dashes.

---

## Still to write down

Decided as the next sections to add, and deliberately not written from memory: each needs the
code read first, and where the surfaces already disagree that has to be recorded as a finding
rather than smoothed over.

- **Notices and empty states.** Toasts, banners, the no-capture notice, and what a screen shows
  when it has nothing. The map half is now in **Bars** above; the app's toasts are not.
- **Forms and fields.** Inputs, labels, validation, the login and registration flow.
- **Onboarding and explanation.** Coach marks, the tour, tooltips: which pattern when.

## Open, not yet decided

- The fade floor is one number for both themes. Measured on the map at 1180px: the faintest row
  reads at contrast 1.90 on dark and 1.56 on light, so light falls further back. Equalising would
  need roughly 0.31 there.
- `#map`'s top is still measured once rather than on every bar change (#405).
  One row makes that much harder to hit, since the bar no longer grows after
  load, but the watcher that misses content growth is still the one in place.
