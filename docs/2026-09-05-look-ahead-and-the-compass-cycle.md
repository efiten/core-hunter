# The map looks ahead while it turns with you, and the compass button has three stops (#403)

**Date:** 2026-09-05
**Status:** decided (Kasper, 2026-09-05), implemented
**Related:** #116 and #259 (the cycle and the ring), #242 (GPS course as a heading source, `COURSE_MIN_SPEED_MS`), #337 and #373 (the other FABs' cycles), #570 (the ticker's sizes, which share the look-ahead area)

## What changed

While following, the hunter's position sat at the exact centre of the viewport: half the map was road already driven. In heading mode the map is oriented so that ahead is up, and that upper half is the only part that can say where the signal is going.

1. **Look-ahead.** While the map is oriented to travel (following with the device compass or the GPS course) the position sits two thirds down the frame. North-up follow and static stay centred: there "ahead" is not a direction. Implemented as MapLibre padding on the top of the viewport, a third of its height (`lookAheadPadding`, `app/src/rotation.js`), so every camera path (the per-fix follow, recenter, centerOn) shares one centre instead of each carrying an offset. The map re-derives it on resize. Measured in the browser at 780 px: padding 260, position at 0.667 of the height.
2. **Three stops on the compass button**: static, follow north-up, heading. Driving is no longer a stop. In heading mode the sensor follows the speed (`autoSource`): the GPS course takes over at 2 m/s (the existing `COURSE_MIN_SPEED_MS`) and hands back to the compass below 1 m/s, so a crawl at the threshold does not swap sensors at every fix. The ring shows the stop, not the sensor; the label names both ("Compass: heading (GPS course while driving)").
3. **A correction disarms the automatic switch.** A two-finger rotate takes rotation over and clears the source, as it did; since only a live source is ever switched, nothing changes sensors again until the mode is cycled back.
4. **The button releases follow.** Heading taps to static, where that used to take a pan. The map keeps its bearing; the next tap follows north-up and resets it.
5. **Recenter eases** (400 ms) to the padded centre rather than jumping, so with padding in play the hand sees where the map went.

## Why these and not the alternatives

- Padding on the bottom, as the issue proposed, moves the centre up: MapLibre puts the camera centre in the middle of the un-padded area. The test pins the top.
- One padding for 2D and 3D. At pitch 60 the same offset buys more look-ahead, which is the direction wanted; a smaller 3D padding was on the table and not taken.
- Four states on a one-handed control was one too many, and both references (Waze, Maps) switch orientation by themselves rather than asking. Auto with a disarm after a correction keeps the hand in charge.
- A button that cannot let go was the odd one out on the rail; every other FAB has an off state you can tap to.

## Left out

- The hidden-count and ticker geometry above the puck: the ticker's own sizes (#570) decide how much of the look-ahead area they take.
- A 'driving' preview icon: the sensor switches by itself, so a tap never produces it.
