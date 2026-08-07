# Decision — merge the layer FAB and 2D/3D FAB into one 5-state view cycle (#258)

2026-07-16. Two FABs (layer-toggle: both/points/hex, from #141; the 2D/3D
toggle, from #147 phase 2) covered a 3×2 = 6-combination matrix, but only 5 of
those combinations are useful. Merging them into one FAB frees a slot in the
FAB stack.

## The 5 states (view FAB, cycled)

1. 2D · points
2. 2D · hex + points
3. 3D · hex (bars)
4. 3D · points
5. 3D · hex + points

**"2D · hex only" is deliberately dropped** — 5 states, not the full matrix.
"3D · points" depends on points being visible in 3D at all (#250 — raised
pillar markers), already shipped by the time this landed.

## Behaviour choices

- Icon shows the current state — the 2D icons are the original flat
  points/hex+point glyphs; the 3D icons are drawn isometrically (a hex-prism
  outline, standing pillars, or both) so 2D vs 3D reads at a glance without a
  separate icon, not just the tilted map behind the FAB.
- Cycle-position ring (`fabRingSvg`, #259) applies here too — 5 segments,
  filled up through the current index, same convention as the layer/sound
  FABs already had.
- **Persisted** in localStorage (`core-hunter-view`), keyed by a stable string
  (`points2d`/`both2d`/`hex3d`/`points3d`/`both3d`) rather than a numeric
  index, so storage survives `VIEW_STATES` being reordered later. Neither the
  old layer-mode nor the old 2D/3D state was persisted before this change (a
  reload always reset to both/2D), so there was nothing to migrate — an
  unknown/corrupt/absent value falls back to state 2 (both/2D), the app's
  cold default before this merge.
- Frees one FAB slot (see the app's ongoing "move FABs down" housekeeping).
