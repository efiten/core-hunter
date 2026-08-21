# Collapsing coincident 3D pillars, and why the flat layer keeps all of them

Decision for #402. Written 2026-08-19 against `app/src/huntmap.js` and
`app/src/pointmarker.js` as they stand.

## The defect

`buildPoints3DFC` emitted one octagon per record with no spatial collapse. A
hunter standing still logs many receptions within metres of each other, and
`pillarRadiusM` clamps to a minimum on-screen radius, so at ordinary zoom every
pillar in such a cluster is the same size at the same place. Coplanar side walls
in a single depth pass z-fight: the field report was one column striped red and
teal along its whole height, restriping as the camera moved.

#302 made it louder rather than quieter — tier opacity and age-fade now ride in
the colour's alpha, and translucent extrusions fight more visibly than opaque
ones. #333's raised tilt ceiling will make it louder again, for the same reason
as #318: extreme pitch shows far more of each pillar's side wall.

## Three decisions

**1. The collapse key is a fixed 10 m distance, not a hex cell.**

`buildHexFC` collapses by `hexCellAt` at the current resolution, and reusing
that would make both layers answer "many receptions here" identically. It was
rejected: it snaps a pillar to its cell centre, and this layer exists to show
where a reception actually was. It would also change the cluster's shape as the
user zooms, because `hexResForZoom` changes resolution.

10 m is `dedupeSpatial`'s cell (`locate.js`), reused because both answer the
same question — these samples are one place, not several — and both were written
for a hunter who is not moving. It is comfortably wider than the 3 m pillar
radius, so nothing left standing after a collapse can overlap a neighbour.

**2. The survivor is the record itself, at its own coordinates.**

Strongest RSSI wins, which is what `buildHexFC` and `dedupeSpatial` already do.
The record is returned whole rather than summarised, so it keeps its `id` and a
tap still resolves through `lastRecords` to the same log row as before (#130,
#309). Nothing about the popup or the ticker sync changes.

**3. The flat 2D `points` layer is deliberately left uncollapsed.**

Circles have no side walls, so 2D has overplotting but not this defect. The cost
is stated rather than hidden: 2D and 3D now draw a different number of markers
for the same records — measured on a 13-record fixture, 13 circles against 2
pillars. That is a known gap, not an oversight; if the difference reads as a bug
in the field, collapsing both is the fix, and the rule is already a shared pure
function.

## Why not `dedupeSpatial` itself

It bins to a grid and keeps one record per cell. Two samples a metre apart that
straddle a cell boundary land in different cells and both survive — which is
exactly the defect, unfixed. For weighting a position estimate that costs
nothing, which is why it was fine there.

So `collapsePillars` uses the grid only as an index: a record is dropped when a
stronger survivor already sits within `cellM`, and the 3x3 neighbourhood scan is
what makes a position on a cell boundary behave like one in the middle. Work per
record is bounded, unlike an all-pairs scan.

One consequence of measuring distance rather than sharing a cell: a 10 m cell is
14 m across the diagonal, so two survivors can legitimately share a cell. The
index holds a list per cell for that reason — keying survivors by cell alone
silently dropped one of them, which is a bug the first version of this change
had and a test now pins.
