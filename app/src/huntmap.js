import { hexCellAt, hexBoundary, hexResForZoom } from './hexgrid.js'
import { rssiTier, tierColorVar, fillOpacity, effectivePlotOffset, extrusionHeight, tintOver, pillarAlpha, EXTRUSION_LIGHT_INTENSITY } from './signal.js'
import { getConfig } from './config.js'
import { nodesInView, driftPresentation, groupSenderPointsForNodes, estimateFor, circleRing } from './nodelayer.js'
import { unclutteredLabels, createLabelMeasurer } from './nodelabels.js'
import { appendTrailPoint } from './trail.js'
import { packetTypeLabel } from './filters.js'
import { layerVisibility, pitchTransition } from './maplayers.js'
import { coverageStars, coverageFeatures, assignHues, isRepeaterHearing, selectionDim, starKey, starSelected, starLabel } from './coverage.js'
import { createRayLayer } from './raylayer.js'
import { octagonRing, pillarRadiusM, collapsePillars, PILLAR_MERGE_M } from './pointmarker.js'
import { recordsKey, lastValueCache, hueKey, selectionKey, ownersKey } from './rendercache.js'
import { currentRideStart, isBacklog, showBacklogPoints } from './rides.js'
import { hexCellLabel, showHexLabels, planHexLabels } from './hexlabels.js'
import { senderText } from './receptionlog.js'
import { pickName } from './feed.js'
import { skyForHour, currentHour } from './sky.js'
import { DEM_TILES, DEM_ENCODING, DEM_MAX_ZOOM, DEM_ATTRIBUTION, DEFAULT_EXAGGERATION, hillshadeFor, terrainPlan, reportMapError } from './terrain.js'
import { followAfter, paddingAction } from './rotation.js'
import { STYLE_RETRY_MS, nextStyleAttempt } from './basemapswap.js'

// Map layer — MapLibre GL (#147). Migrated from Leaflet + leaflet-rotate: native
// rotation/pitch replaces the plugin (and its zoom-drift patch, #167/#168), and
// a vector basemap (OpenFreeMap) unlocks 3D buildings in the follow-up
// 3D phase. The createHuntMap(...) API is unchanged so app.js stays as-is.

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

// OpenFreeMap hosted vector styles (key-free); both use the "openmaptiles"
// vector source. --ch-basemap ('dark'|'light') is the app's theme hint.
const STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
}
const EMPTY = { type: 'FeatureCollection', features: [] }
const fc = (features) => ({ type: 'FeatureCollection', features })
// Bare background-only style — loads with no network, so the signal overlays
// can mount on it when the hosted basemap style is unreachable (see below).
const bareStyle = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] })

// The overlay stack, bottom to top (#626). Every add in addOverlays is guarded
// with getLayer, so the order used to be whatever the adds happened to run in:
// a run that landed on a half-applied style added part of the stack and the
// next run put the rest on top of it, which is the over/under drawing the issue
// reports. Declared here and applied in one pass at the end of addOverlays.
//
// Exported so the suite can hold it against the layers the module actually
// adds — a layer added and not declared would silently float to the top.
// The custom ray layer is not here: it is mounted through raylayer.js and
// stays above everything by construction.
export const LAYER_ORDER = [
  'hillshade',      // terrain shading, under everything we draw
  'trail',
  'hex', 'hex-3d',
  'buildings-3d',
  'reach',          // the coverage rays, under the dots so a hub stays readable
  'points', 'pulse', 'points-3d', 'pulse-3d',
  'highlight', 'here',
  // The node-position layer sits above the hex heat: it is an explicit opt-in
  // overlay, and a connector buried under a hot cell defeats drawing it.
  'nodedrift', 'nodecircle-search', 'nodecircle-drift',
]

// 3D mode (#147 phase 2): setView() tilts the camera (pitchTransition,
// maplayers.js) and swaps the flat hex layer for its fill-extrusion twin —
// same 'hex' source, height added per feature (extrusionHeight). Buildings
// reuse the OpenFreeMap style's own "openmaptiles"/"building" source, already
// fetched for the 2D basemap, so 3D adds no new data request. (Terrain was
// dropped — see docs/2026-07-11-3d-mode.md: its AWS DEM tiles kept the map in
// a perpetual load loop and froze weaker GPUs.)

// Ceiling for the two-finger tilt gesture (#333). MapLibre's own default
// maxPitch is 60 — the same value the FAB eases to (PITCH_3D, maplayers.js) —
// so without this the gesture bottomed out exactly where the FAB left off and
// the camera could never look along the ground. 85 is MapLibre's hard maximum
// (86+ throws "maxPitch must be less than or equal to 85"); 90 is not offered
// because a camera level with the horizon projects to infinity.
// PITCH_3D deliberately stays 60: the FAB is the introduction to 3D, and the
// gesture is what takes you the rest of the way. Those two compose because
// setView() only eases when a tap crosses the 2D/3D line (pitchTransition) --
// cycling between 3D states leaves a gesture-set angle where it is, and
// leaving 3D is what puts the camera back to a known one.
const MAX_PITCH = 85
// Points-in-3D (#250): a small standing "pillar" per reception, same tier
// height/colour as hex-3d's bars, so it reads clearly in the tilted view
// instead of disappearing under the hex/building geometry (a flat circle
// layer can't be raised — MapLibre circles always sit on the ground plane).
const POINT_PILLAR_RADIUS_M = 3
// Minimum on-screen RADIUS (centre -> vertex), not half-width: keeps the
// footprint off sub-pixel when zoomed out (#250). Across the flats that is
// 4 x cos(pi/8) = 3.70 px, deliberately slimmer than the old square (#308).
const POINT_PILLAR_MIN_RADIUS_PX = 4
// The trail's own opacity, named so the layer and the #624 selection dim read
// the same number rather than two copies of 0.5 that could drift apart.
const TRAIL_OPACITY = 0.5

export function createHuntMap(containerId) {
  const stub = { setPosition() {}, centerOn() {}, recenter() {}, onFollowChange() {}, render() {}, setView() {}, applyBasemap() {}, focusReception() {}, setAttenuator() {}, setBearing() {}, onGestureRotate() {}, setHighlight() {}, onMarkerFocus() {}, setNodePositions() {}, releaseFollow() {}, setLookAhead() {}, setNodeLayer() {}, setExaggeration() {}, pulse() {}, destroy() {} }
  // Degrade to a no-op map (never throw during app init) when MapLibre did not
  // load, or when WebGL is unavailable — GPU blocklist, an older
  // device, or a lost context — since `new maplibregl.Map` throws synchronously
  // in that case (Leaflet's raster map had no WebGL dependency).
  if (typeof maplibregl === 'undefined') return stub
  const cfg = getConfig()
  const calibrationOffset = (cfg && cfg.rssiCalibrationOffset) || 0
  // Plot offset = calibration + attenuator added back (display-only, per tick).
  let attenuatorDb = 0
  const currentOffset = () => effectivePlotOffset(calibrationOffset, attenuatorDb)
  const styleFor = () => STYLES[cssVar('--ch-basemap') || 'dark'] || STYLES.dark

  let map
  try {
    map = new maplibregl.Map({
      container: containerId, style: styleFor(), center: [4, 51], zoom: 14,
      // pitchWithRotate governs the MOUSE path only (ctrl/right-drag); touch
      // pitch is a separate handler that already defaults on. Left false, a
      // desktop browser has no tilt gesture at all, so raising maxPitch alone
      // changed nothing there even though a phone could already tilt. Setting
      // it true reverses docs/2026-07-11-3d-mode.md's "not a free-tilt 3D
      // explorer" for mouse input only -- see docs/2026-08-17-free-tilt.md.
      attributionControl: false, dragRotate: true, pitchWithRotate: true, maxPitch: MAX_PITCH,
    })
  } catch (e) { return stub }
  map.addControl(new maplibregl.AttributionControl({ compact: true }))

  let mode = 'both', lastRecords = [], lastSelected = null
  let highlightId = null, onMarkerFocusCb = null, rotateCb = null, mode3D = false
  // Terrain (#396): the 3D view raises it (Kasper, 2026-09-06: no switch of
  // its own), at the exaggeration from Settings, applied through terrainPlan.
  // demReady flips once the DEM source has tiles for the view; until then the
  // map stays flat, whatever the view says (#394 left "what does the map do
  // when the host is slow" open; this is the answer). It is reset on every
  // style load, since setStyle drops the source.
  let terrainExag = DEFAULT_EXAGGERATION, demReady = false
  map.on('sourcedata', (e) => {
    if (e.sourceId === 'dem' && e.isSourceLoaded && !demReady) { demReady = true; applyTerrain() }
  })
  // Every map error reaches the console except a failed DEM tile, which only
  // leaves the map flat (terrain.js).
  map.on('error', reportMapError)
  // Node-position layer (#197): registry nodes with a self-advertised position,
  // drawn against our own estimate. Off until the FAB turns it on.
  let nodePositions = [], nodeLayerMode = 'off', nodeMarkers = []
  const nodeLayerOn = () => nodeLayerMode !== 'off'
  // The coverage (#603): every repeater's reach in the layer's third stop.
  // coverageSel is the marker-tap selection; a picked target counts too
  // (lastSelected). coverageHue is the hue each repeater got in the last
  // draw, read by the dots and the ▲ markers. lastReachRows is the record set
  // the stars are built from when a target narrows the plotted set: the other
  // stars must stay up at a quarter, so app.js hands the sender-free rows.
  // starCache keeps each star's estimate from tick to tick (coverage.js).
  const coverageSel = new Set(), starCache = new Map()
  let coverageHue = new Map(), lastReachRows = null, hubMarkers = []
  // A reception's attribution by reach (#661, attribution.js): app.js works it
  // out every tick and puts it on the row as _attr, so the stars, the dots and
  // the node-position layer place a relay id exactly as the HUD names it.
  const attributionOf = (pt) => pt._attr || null
  const rays = createRayLayer('reach-3d', {
    toMerc: (lon, lat, alt) => maplibregl.MercatorCoordinate.fromLngLat([lon, lat], alt),
    elevation: (lon, lat) => (typeof map.queryTerrainElevation === 'function' && map.getTerrain && map.getTerrain() ? (map.queryTerrainElevation([lon, lat]) || 0) : 0),
  })
  const coverageOn = () => nodeLayerMode === 'reach'
  function applyReachVisibility() {
    if (map.getLayer('reach')) map.setLayoutProperty('reach', 'visibility', coverageOn() && !mode3D ? 'visible' : 'none')
    rays.setVisible(coverageOn() && mode3D)
  }
  function coverageSelected() {
    const ids = new Set(coverageSel)
    for (const id of lastSelected || []) ids.add(String(id).toLowerCase())
    return ids
  }
  function toggleCoverageSelection(id) {
    const key = String(id).toLowerCase()
    if (coverageSel.has(key)) coverageSel.delete(key); else coverageSel.add(key)
    nodePosSig = null
    draw()
  }
  function clearCoverageSelection() {
    if (!coverageSel.size) return
    coverageSel.clear(); nodePosSig = null; draw()
  }
  // The dots of the points layer take the repeater's hue while the reach is
  // on (#603), the tier colour otherwise; the pillars keep the tier. A hearing
  // placed on a node by reach takes that node's star's hue, a collided one
  // none (starKey, #661).
  function pointHue(r) {
    if (!coverageHue.size || !isRepeaterHearing(r) || r.sender_id == null) return null
    const key = starKey(r, attributionOf(r))
    return key == null ? null : coverageHue.get(key) || null
  }
  // The star a reception belongs to, by the same attribution the stars use
  // (starKey, #661): the node's pubkey when reach placed it, its own id
  // otherwise, and null for a collision or a reception that belongs to no
  // repeater (#624). What selectionDim is asked about for a dot, a cell or a
  // pillar.
  const ownerOf = (r) => (isRepeaterHearing(r) && r.sender_id != null ? starKey(r, attributionOf(r)) : null)
  // Builds the stars for this tick, puts the rays up (one setData feeds the
  // 2D line source and the 3D ray layer), a ● hub for a star with no registry
  // position, and remembers the hues. Returns the selection for the markers:
  // the selected ids, and the ids of the stars they select (starSelected), so
  // a ▲ whose star was picked by a relay id placed on it is not dimmed.
  function drawCoverage(records) {
    hubMarkers.forEach((m) => m.remove()); hubMarkers = []
    if (!coverageOn() || !map.getSource('reach')) {
      coverageHue = new Map(); starCache.clear()
      if (map.getSource('reach')) { map.getSource('reach').setData(EMPTY); rays.setData([]) }
      return null
    }
    const byKey = new Map(nodePositions.map((n) => [String(n.pubkey).toLowerCase(), n]))
    const positionOf = (id) => { const n = byKey.get(id); return n ? { lat: n.lat, lon: n.lon } : null }
    const stars = coverageStars(lastReachRows || records, { positionOf, cache: starCache, attributionOf })
    const hues = assignHues(stars.map((st) => ({ id: st.id, lat: st.origin.lat, lon: st.origin.lon })))
    const colorOf = (slot) => cssVar(`--ch-hue-${slot}`)
    const selected = coverageSelected()
    const fcRays = coverageFeatures(stars, { slotOf: (id) => hues.get(id), colorOf, selected })
    const selectedStars = new Set(selected.size ? stars.filter((st) => starSelected(st, selected)).map((st) => st.id) : [])
    coverageHue = new Map([...hues].map(([id, slot]) => [id, colorOf(slot)]))
    map.getSource('reach').setData(fcRays)
    rays.setData(fcRays.features)
    for (const st of stars) {
      if (st.origin.kind !== 'estimate') continue   // the ▲ of the node layer is the hub
      const el = document.createElement('div')
      el.className = 'rc-hub' + (selected.size && !selectedStars.has(st.id) ? ' np-dim' : '')
      el.style.background = coverageHue.get(st.id)
      // A hub keyed by one byte reads '#64', never a bare hash (starLabel).
      el.title = `${starLabel(st)}: reach from its RSSI estimate, ${st.points.length} hearings. A lower bound from where you drove; unmeasured is not unreachable.`
      el.addEventListener('click', (e) => { e.stopPropagation(); toggleCoverageSelection(st.id) })
      hubMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([st.origin.lon, st.origin.lat]).addTo(map))
    }
    return { selected, selectedStars, count: fcRays.features.length }
  }
  // One probe per map for the label declutter (#539/#425): widths are
  // measured inside the map container, where .np-label's font actually
  // applies (a body probe reads the page's font and measures wrong).
  let npMeasure = null
  const labelMeasurer = () => npMeasure || (npMeasure = createLabelMeasurer(map.getContainer()))
  let nodePosSig = null   // signature guard: skip the rebuild when nothing changed, so a tapped popup survives the tick
  // The repeater whose popup comes back after a selecting tap (#623). A tap
  // that selects redraws the node layer, and the redraw removes every marker,
  // the tapped one included, so its popup has to be reopened on the rebuilt one.
  let reopenNodeKey = null
  const ACQUIRE_ZOOM = 18
  let follow = true, lastPos = null, onFollow = null, acquired = false
  let trail = [], settingBearing = false

  // Follow changes only through followAfter (rotation.js), which says per input
  // whether it needs a position; onFollow hears every change, so the compass
  // button's state never sits on a stop the map did not take.
  function setFollow(input) {
    const next = followAfter(follow, input, lastPos != null)
    if (next === follow) return
    follow = next
    if (onFollow) onFollow(follow)
  }
  // Native bearing gesture reports back via onGestureRotate (guarded so our own
  // setBearing calls don't count as user input). Any deliberate "look somewhere
  // else" gesture releases follow, or the next GPS fix jumpTo's the camera
  // straight back (setPosition). Shared by the drag handler and by
  // focusReception (#309), which is the same intent by tap.
  const lookAway = () => setFollow('look-away')
  map.on('dragstart', lookAway)
  // The compass button's release (#403), with or without a fix.
  function releaseFollow() { setFollow('release') }
  // Look-ahead (#403): the app decides when the map is oriented to travel and
  // hands the padding in; the map re-derives it from its own height on resize,
  // so a rotated phone keeps the position at the same fraction of the frame.
  // Every write goes through paddingAction (rotation.js), because setPadding
  // is a jumpTo and a jumpTo cancels a running gesture (#236). The switch-off
  // arrives from the gesture handlers right above: a drag releases follow, a
  // two-finger rotate clears the source. A held padding lands at moveend,
  // when there is no gesture left to cut off.
  const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 }
  let lookAhead = null, padding = NO_PADDING, paddingHeld = false
  function applyPadding() {
    const next = lookAhead ? lookAhead(map.getContainer().clientHeight) : NO_PADDING
    const action = paddingAction(padding, next, map.isMoving() || map.isZooming())
    paddingHeld = action === 'hold'
    if (action !== 'apply') return
    padding = next
    map.setPadding(next)
  }
  function setLookAhead(paddingFor) { lookAhead = paddingFor || null; applyPadding() }
  map.on('resize', () => { if (lookAhead) applyPadding() })
  map.on('moveend', () => { if (paddingHeld) applyPadding() })
  map.on('rotate', () => { if (rotateCb && !settingBearing) rotateCb(map.getBearing()) })
  // Hex resolution depends on zoom — rebuild once the zoom settles.
  map.on('zoomend', () => draw())

  // ---- feature builders (GeoJSON sources are updated via setData) ----
  // The current ride's first reception (#556): everything before it is
  // backlog. Cached on the records, since splitting sorts them.
  const rideCache = lastValueCache()
  function rideStartFor(records) {
    const sig = recordsKey(records)
    return rideCache.get(sig, () => currentRideStart(records))
  }
  // Cacheable since #648 took the age fade out: what a dot looks like now
  // depends on the records, whether this zoom draws backlog outlines, the
  // attenuator offset, the theme's tier colours and the coverage hues — and on
  // nothing that moves on its own. All six are in the key, because a cache that
  // misses one input serves the previous tick's answer for a different question.
  const pointsCache = lastValueCache()
  function buildPointsFC(records, sel, owners) {
    const outlines = showBacklogPoints(map.getZoom())
    const sig = recordsKey(records), hues = hueKey(coverageHue)
    // Unsignable on either axis means recompute: a key carrying "null" would
    // match another set that also could not be signed. The selection joined
    // the key in #624, since it dims every dot outside it: a tap changes no
    // record, so without it the cache would hand back the undimmed map. The
    // owners joined in #661 (ownersKey): a dot's star follows its attribution.
    const key = sig === null || hues === null || owners === null
      ? null
      : `${sig}|${outlines ? 1 : 0}|${currentOffset()}|${cssVar('--ch-basemap')}|${hues}|${selectionKey(sel)}|${owners}`
    return pointsCache.get(key, () => buildPointsFCUncached(records, outlines, sel))
  }
  function buildPointsFCUncached(records, outlines, sel) {
    const feats = []
    // Backlog (#556): below BACKLOG_OUTLINE_ZOOM a reception from an earlier
    // ride is coverage only, its hex cell; from that zoom it comes back as an
    // outline, in its tier colour, no fill. The ride itself is drawn filled,
    // as before.
    const rideStart = rideStartFor(records)
    for (const r of records) {
      if (r.lat == null || r.lon == null) continue
      const backlog = isBacklog(r, rideStart)
      if (backlog && !outlines) continue
      const tier = rssiTier(r.rssi, currentOffset())
      // op is the stroke, fop the fill. The stroke is full since #648: it used
      // to carry the age fade alone, and it is what keeps a faint reception
      // findable on the map, so the tier belongs in the fill and not in it.
      // A selection (#624) steps both back for every dot that is not the
      // selected repeater's, so the other repeaters' dots no longer sit at full
      // colour on top of their own dimmed rays.
      const dim = selectionDim(sel, ownerOf(r))
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { id: String(r.id), color: pointHue(r) || cssVar(tierColorVar(tier)), op: dim, fop: fillOpacity(tier) * dim, backlog: backlog ? 1 : 0 } })
    }
    return fc(feats)
  }
  // 3D twin of buildPointsFC (#250): an octagon footprint per reception (#308
  // rounded this from a square to match the flat 2D circle it replaces),
  // extruded to the same tier height as hex-3d's bars (extrusionHeight), so
  // hotter/closer receptions stand taller — same colour/height language as the
  // hex bars, just narrower, so points still read distinctly from hex cells.
  // fill-extrusion-opacity is layer-wide (MapLibre has no data-driven opacity
  // for it, same limitation noted on hex-3d), but fill-extrusion-color IS
  // per-feature — so tier opacity and age-fade ride in the colour's alpha
  // instead of being dropped (#302).
  // collapsePillars first (#402): coincident octagons are coplanar side walls in
  // one depth pass, which z-fights. It also drops the unpositioned records this
  // loop used to skip itself, so there is no second guard here. The flat 2D
  // layer is deliberately left uncollapsed -- circles have no side walls, so it
  // has overplotting but not this defect.
  // Two caches, both earning their keep (#462, #648). collapsePillars is the
  // single most expensive thing a tick does — 157 ms of a 193 ms tick at the
  // largest observed store — and depends only on the records. The collection
  // built from it used to carry ageFade, a function of the clock, so it had to
  // be rebuilt every tick; with the fade gone it depends on the records, the
  // zoom (the footprint), the offset and the theme, and all four are in the key.
  const collapseCache = lastValueCache()
  const pillarsCache = lastValueCache()
  function buildPoints3DFC(records, sel, owners) {
    const sig = recordsKey(records)
    // The selection is in the key since #624, for the reason it is in the flat
    // points' key: it dims every pillar outside it without changing a record.
    // So are the owners since #661, which decide which pillars it keeps lit.
    const key = sig === null || owners === null ? null : `${sig}|${map.getZoom()}|${currentOffset()}|${cssVar('--ch-basemap')}|${selectionKey(sel)}|${owners}`
    return pillarsCache.get(key, () => buildPoints3DFCUncached(records, sel))
  }
  function buildPoints3DFCUncached(records, sel) {
    const feats = []
    const rideStart = rideStartFor(records)
    // The ride outranks the strength in the collapse (#647). The survivor is
    // what the pillar says, not only where it stands, so a louder reception
    // from an earlier ride must not stand in for one that just arrived at the
    // same spot: that would read as "not heard here today" on a place just
    // heard. rideStart comes from the records, so the collapse still answers to
    // them alone and its cache key is unchanged.
    const thisRide = (r) => (isBacklog(r, rideStart) ? 0 : 1)
    for (const r of collapseCache.get(recordsKey(records), () => collapsePillars(records, PILLAR_MERGE_M, thisRide))) {
      const tier = rssiTier(r.rssi, currentOffset())
      const ring = octagonRing(r.lat, r.lon, pillarRadiusM(r.lat, map.getZoom(), POINT_PILLAR_RADIUS_M, POINT_PILLAR_MIN_RADIUS_PX))
      // Opaque, pre-mixed over the theme background, the way the hex bars are
      // painted (#412, pillarTint). Not a style choice: MapLibre composites a
      // translucent fill-extrusion against black rather than against what lies
      // under it, measured 2026-09-14 with an opaque light layer directly
      // beneath one. On the dark theme that is invisible, since the ground is
      // nearly black anyway, which is why it stood this long. On the light
      // theme it inverts the meaning -- a lower alpha becomes MORE ink on a
      // cream map, so a backlog pillar would stand out harder than a fresh one,
      // the exact opposite of what #647 asks for. Pre-mixing makes a lower
      // alpha mean "closer to the ground" on both themes.
      //
      // Which alpha is the ride rule itself (#647): the tier's own opacity for
      // this ride, one flat value below the weakest tier for everything before.
      // A selection (#624) multiplies onto that, and because the colour is
      // pre-mixed a dimmed pillar moves toward the ground on both themes rather
      // than toward black on the light one.
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { id: String(r.id),
          color: tintOver(cssVar(tierColorVar(tier)), cssVar('--ch-bg'), pillarAlpha(tier, isBacklog(r, rideStart)) * selectionDim(sel, ownerOf(r))),
          height: extrusionHeight(r.rssi, currentOffset()) } })
    }
    return fc(feats)
  }
  // Fully cacheable, unlike the point collections: nothing here reads the clock.
  // A cell's colour and height come from the best RSSI in it and the attenuator
  // offset, so the answer changes only when the records, the zoom resolution or
  // that offset do — all three are in the key (#462).
  const hexCache = lastValueCache()
  function buildHexFC(records, sel, owners) {
    const res = hexResForZoom(map.getZoom())   // finer cells the more you zoom in
    // An unsignable set must not be cached under the string "null|10|0", which
    // is a perfectly good cache key and exactly the wrong one — the null has to
    // survive into the lookup.
    const sig = recordsKey(records)
    // The theme is in the key too (#412): the colours are read from the
    // tokens at build time, so a theme switch on unchanged records must not
    // serve the other theme's cells and bars from the cache. So is the
    // selection (#624), which dims cells without changing a record, and so are
    // the owners (#661), which decide the cells it keeps lit.
    return hexCache.get(sig === null || owners === null ? null : `${sig}|${res}|${currentOffset()}|${cssVar('--ch-basemap')}|${selectionKey(sel)}|${owners}`, () => buildHexFCUncached(records, res, sel))
  }
  function buildHexFCUncached(records, res, sel) {
    // A cell holds receptions from several repeaters at once, so it cannot ask
    // selectionDim about one owner. It stays lit when ANY reception in it
    // belongs to a selected repeater (#624): the cell is where that repeater
    // was heard, even if a louder one from elsewhere set its colour. With no
    // selection every reception answers 1, so every cell is lit and nothing
    // changes from before.
    const cells = new Map()
    for (const r of records) {
      if (r.lat == null || r.lon == null) continue
      const id = hexCellAt(r.lat, r.lon, res)
      const lit = selectionDim(sel, ownerOf(r)) === 1
      const cur = cells.get(id)
      if (!cur) { cells.set(id, { best: r.rssi, lit }); continue }
      if ((r.rssi ?? -999) > (cur.best ?? -999)) cur.best = r.rssi
      if (lit) cur.lit = true
    }
    const feats = []
    const bg = cssVar('--ch-bg')
    for (const [id, c] of cells) {
      const ring = hexBoundary(id); if (!ring) continue // [lat,lon] closed ring → [lon,lat]
      const tier = rssiTier(c.best, currentOffset())
      const token = cssVar(tierColorVar(tier))
      const alpha = fillOpacity(tier) * (c.lit ? 1 : selectionDim(sel))
      // height and pillar are only read by the 3D fill-extrusion twin (hex-3d);
      // the flat 'hex' layer ignores them. Same source for both, per the
      // decision log. pillar is the cell's tint pre-mixed over the theme
      // background (#412): opaque, so the bar reads as its cell does. It takes
      // the same dimmed alpha as the flat cell, which is what pillarTint would
      // give undimmed, so a bar and its cell still agree under a selection.
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring.map(([la, lo]) => [lo, la])] },
        properties: { color: token, op: alpha, pillar: tintOver(token, bg, alpha), height: extrusionHeight(c.best, currentOffset()) } })
    }
    return fc(feats)
  }
  function buildHighlightFC() {
    if (highlightId == null) return EMPTY
    const r = lastRecords.find((x) => String(x.id) === String(highlightId))
    if (!r || r.lat == null || r.lon == null) return EMPTY
    return fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: {} }])
  }
  function buildHereFC() {
    if (!lastPos) return EMPTY
    return fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [lastPos[1], lastPos[0]] }, properties: {} }])
  }
  function buildTrailFC() {
    if (trail.length < 2) return EMPTY
    return fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: trail.map(([la, lo]) => [lo, la]) }, properties: {} }])
  }
  // ---- overlays: added on every style load (initial + theme switch) ----
  // overlaysReady flips true once the signal layers are mounted; the fallback
  // timer (armStyleFallback) uses it so a stuck basemap style can't leave the
  // map blank — the overlays must not be gated on a third-party basemap.
  let overlaysReady = false, styleTimer = null, styleAttempt = 0
  function armStyleFallback() {
    clearTimeout(styleTimer)
    styleTimer = setTimeout(() => {
      if (overlaysReady) return
      // The hosted style never even parsed (offline / host down / cold PWA
      // cache). It gets one more try before the map gives it up (#626): the
      // old net dropped straight to a flat background and stayed there for the
      // session, which is what a merely slow style looked like. Past that the
      // bare style mounts the overlays, so the signal points/hex/trail/here
      // survive basemap loss.
      if (nextStyleAttempt(styleAttempt++) === 'retry') {
        map.setStyle(styleFor()); afterStyle(addOverlays); armStyleFallback(); return
      }
      map.setStyle(bareStyle(cssVar('--ch-bg'))); mountBare()
    }, STYLE_RETRY_MS)
  }
  // Sky (#397). setStyle DROPS the sky — measured against the bundled 4.7.1:
  // getSky() returns null after a style swap — so this cannot be a one-off at
  // construction. It is re-applied from addOverlays, which is the one hook that
  // runs on every style load: initial, theme switch (applyBasemap) and the bare
  // fallback. Guarded on the method existing so an older MapLibre degrades to
  // the previous no-sky behaviour rather than throwing during init.
  function applySky() {
    if (typeof map.setSky !== 'function') return
    // setSky THROWS while a style is still loading — measured: with
    // isStyleLoaded() false it dies on "Cannot read properties of undefined
    // (reading 'transition')". addOverlays only runs post-load, but the minute
    // timer below is independent and can fire mid-swap (applyBasemap →
    // setStyle → loading), so it needs the guard. Nothing is lost by skipping:
    // addOverlays re-applies the sky as soon as that style finishes.
    if (!map.isStyleLoaded()) return
    // || 'dark' matches styleFor()'s rule for the same token: empty means the
    // stylesheet has not applied, and the app's default is the dark basemap.
    // sky.js caps only on the exact string 'dark', so this is what decides
    // that a missing token gets the capped palette rather than the light one.
    map.setSky(skyForHour(currentHour(), cssVar('--ch-basemap') || 'dark'))
  }
  // The clock moves during a hunt — a session that starts at dusk would keep a
  // dusk sky at midnight. Once a minute is far finer than the palette changes
  // (the tightest stop gap is 1.5 h) and costs one paint-property write.
  const skyTimer = setInterval(applySky, 60000)

  // ensureDem mounts the DEM source and the hillshade layer under the signal
  // overlays (before 'trail', the first of them), on the current style.
  function ensureDem() {
    if (!map.getSource('dem')) {
      map.addSource('dem', { type: 'raster-dem', tileSize: 256, maxzoom: DEM_MAX_ZOOM, encoding: DEM_ENCODING, tiles: [DEM_TILES], attribution: DEM_ATTRIBUTION })
    }
    if (!map.getLayer('hillshade')) {
      map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': hillshadeFor(terrainExag) } }, map.getLayer('trail') ? 'trail' : undefined)
    }
  }
  // applyTerrain draws the plan for the current state: shading follows the
  // 3D view, the mesh follows the 3D view and the tiles (terrain.js).
  // setTerrain is only called when the plan changes, since each call
  // re-derives the mesh.
  function applyTerrain() {
    // Gated on the overlays being mounted, not on isStyleLoaded(): that one
    // stays false while any tile is still loading, which with a DEM host in
    // the picture can be a long time, and a view tap in that window did
    // nothing. addOverlays runs this itself once the layers are there.
    if (!overlaysReady) return
    const plan = terrainPlan({ mode3D, ready: demReady, exaggeration: terrainExag })
    if (plan.hillshade) {
      ensureDem()
      map.setLayoutProperty('hillshade', 'visibility', 'visible')
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', hillshadeFor(plan.exaggeration))
    } else if (map.getLayer('hillshade')) {
      map.setLayoutProperty('hillshade', 'visibility', 'none')
    }
    const have = map.getTerrain && map.getTerrain()
    if (plan.mesh) {
      if (!have || have.exaggeration !== plan.exaggeration) map.setTerrain({ source: 'dem', exaggeration: plan.exaggeration })
    } else if (have) {
      map.setTerrain(null)
    }
  }
  function setExaggeration(exaggeration) {
    if (exaggeration != null) terrainExag = exaggeration
    applyTerrain()
  }

  function addOverlays() {
    clearTimeout(styleTimer); overlaysReady = true
    applySky()
    // The style light shades every extrusion face; at MapLibre's default it
    // darkened a bar against its own cell (#412). Re-applied here like the
    // sky, since setStyle drops it. Guarded for an older MapLibre.
    if (typeof map.setLight === 'function') map.setLight({ anchor: 'viewport', intensity: EXTRUSION_LIGHT_INTENSITY })
    for (const id of ['trail', 'hex', 'points', 'points-3d', 'highlight', 'here', 'nodedrift', 'nodecircle', 'reach', 'pulse', 'pulse-3d']) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY })
    }
    // One decision for all four signal layers (#266) — see maplayers.js. Both
    // this block and setView() read it, so a style reload and a FAB tap can no
    // longer disagree about what is on screen.
    const vis = layerVisibility({ mode, mode3D })
    const shown = (id) => (vis[id] ? 'visible' : 'none')
    if (!map.getLayer('trail')) map.addLayer({ id: 'trail', type: 'line', source: 'trail',
      paint: { 'line-color': cssVar('--ch-muted'), 'line-width': 3, 'line-opacity': TRAIL_OPACITY } })
    if (!map.getLayer('hex')) map.addLayer({ id: 'hex', type: 'fill', source: 'hex',
      layout: { visibility: shown('hex') },
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } })
    // 3D twin of 'hex': same source, extruded to 'height' (RSSI/SNR tier, #147).
    // fill-extrusion-opacity is not data-driven, and one opacity for every
    // tier is what made a faint bar a solid purple on a 19% tint (#412). The
    // bar takes 'pillar', the cell's tint pre-mixed over the background, and
    // draws it opaque: no translucent compounding, shared walls depth-test.
    if (!map.getLayer('hex-3d')) map.addLayer({ id: 'hex-3d', type: 'fill-extrusion', source: 'hex',
      layout: { visibility: shown('hex-3d') },
      paint: { 'fill-extrusion-color': ['get', 'pillar'], 'fill-extrusion-height': ['get', 'height'],
        // MapLibre shades extrusion sides darker toward their base by default
        // (#412). On a building that reads as depth; on these it reads as a
        // different tier, because colour is the signal the palette carries.
        'fill-extrusion-vertical-gradient': false,
        'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } })
    // Buildings reuse the hosted style's own vector source (already fetched for
    // the 2D basemap) — only present on the hosted OpenFreeMap style, not the
    // bare fallback, hence the source guard.
    // Terrain rides every style load like the sky: setStyle drops the source.
    demReady = false
    applyTerrain()
    if (map.getSource('openmaptiles') && !map.getLayer('buildings-3d')) {
      // minzoom 13, not 14: OpenFreeMap's own TileJSON declares the `building`
      // vector layer at minzoom 13 (verified against tiles.openfreemap.org),
      // so 14 threw away a whole zoom level of geometry that was already in the
      // fetched tiles. 13 is the floor -- there is no building geometry below
      // it. Most visible at high pitch, where the far half of the view sits
      // below the current zoom (#395).
      map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        layout: { visibility: mode3D ? 'visible' : 'none' },
        // Keeps its vertical gradient, unlike the data layers (#412): a
        // building is a shape, so shading is what makes it read as one. The
        // data layers carry meaning in their colour, which is why they lose it.
        paint: { 'fill-extrusion-color': cssVar('--ch-building'),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 3],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.75 } })
    }
    // The coverage rays (#603), under the dots so the hearings stay readable
    // at the hub; the 3D twin is the custom ray layer mounted last.
    if (!map.getLayer('reach')) map.addLayer({ id: 'reach', type: 'line', source: 'reach',
      layout: { visibility: coverageOn() && !mode3D ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': ['get', 'op'] } })
    if (!map.getLayer('points')) map.addLayer({ id: 'points', type: 'circle', source: 'points',
      layout: { visibility: shown('points') },
      // A backlog reception (#556) has no fill and a heavier stroke: colour and
      // place stay, the fill says "this ride".
      paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'],
        'circle-opacity': ['case', ['==', ['get', 'backlog'], 1], 0, ['get', 'fop']],
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': ['case', ['==', ['get', 'backlog'], 1], 1.5, 1],
        'circle-stroke-opacity': ['get', 'op'] } })
    // The pulse (#556): one ring on the reception that just arrived, animated
    // by pulse() below through the paint properties, above the points and
    // shown only where they are.
    if (!map.getLayer('pulse')) map.addLayer({ id: 'pulse', type: 'circle', source: 'pulse',
      layout: { visibility: shown('pulse') },
      paint: { 'circle-radius': 8, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': 2, 'circle-stroke-opacity': 0.9 } })
    // The pulse's 3D form (#648): the reception's own pillar, flashed. A ring
    // would lie on the ground under the pillar it belongs to, which is why
    // #556 left 3D out.
    if (!map.getLayer('pulse-3d')) map.addLayer({ id: 'pulse-3d', type: 'fill-extrusion', source: 'pulse-3d',
      layout: { visibility: shown('pulse-3d') },
      // 1, for the same reason points-3d is 1: the colour arrives already
      // composited over the theme background (#412, #647), so there is no alpha
      // left for a layer-wide value to multiply. The flash animates that colour
      // and never an opacity, and the measurements for why are in pulse().
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-vertical-gradient': false, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } })
    // 3D twin of 'points' (#250): a fill-extrusion pillar per reception, same
    // tier colour/height as hex-3d — reads clearly at pitch instead of a flat
    // circle disappearing under the hex bars/buildings. Separate source (its
    // Polygon footprints can't double as the flat layer's Point geometry, the
    // way hex/hex-3d share one source), and painted the way hex-3d is: opaque,
    // with the tier pre-mixed into the colour (#412, #647).
    if (!map.getLayer('points-3d')) map.addLayer({ id: 'points-3d', type: 'fill-extrusion', source: 'points-3d',
      layout: { visibility: shown('points-3d') },
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'],
        // Off for the same reason as hex-3d (#412): signal.js promises a bar's
        // height and colour always agree on the same tier, and a default-on
        // gradient darkens the sides until they do not.
        'fill-extrusion-vertical-gradient': false,
        // 1, not 0.9: fill-extrusion-color arrives opaque, with the tier and
        // the ride (#647) already composited over the theme background, so a
        // layer-wide opacity has nothing left to multiply. Translucency is what
        // this layer deliberately stopped using -- MapLibre composites a
        // translucent extrusion against black rather than against the map under
        // it, which turned the tier scale upside down on the light theme.
        'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } })
    if (!map.getLayer('highlight')) map.addLayer({ id: 'highlight', type: 'circle', source: 'highlight',
      paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssVar('--ch-accent'), 'circle-stroke-width': 3 } })
    if (!map.getLayer('here')) map.addLayer({ id: 'here', type: 'circle', source: 'here',
      paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssVar('--ch-accent'), 'circle-stroke-width': 2 } })
    // Node-position layer (#197), added last so it sits above the hex heat —
    // it is an explicit opt-in overlay, and a connector buried under a hot hex
    // cell defeats the point of drawing it. The connector is solid; the circle
    // is dashed for a trusted search radius and dotted for the drift fallback,
    // so the two read differently without needing a label.
    if (!map.getLayer('nodedrift')) map.addLayer({ id: 'nodedrift', type: 'line', source: 'nodedrift',
      layout: { visibility: nodeLayerOn() ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9 } })
    // Two layers over one source, split by dash pattern: line-dasharray is not
    // a data-driven property in MapLibre (a `case` expression there fails style
    // validation and the layer never mounts), so each pattern needs its own
    // layer with a constant value and a filter.
    if (!map.getLayer('nodecircle-search')) map.addLayer({ id: 'nodecircle-search', type: 'line', source: 'nodecircle',
      filter: ['==', ['get', 'style'], 'search'],
      layout: { visibility: nodeLayerOn() ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [4, 4] } })
    if (!map.getLayer('nodecircle-drift')) map.addLayer({ id: 'nodecircle-drift', type: 'line', source: 'nodecircle',
      filter: ['==', ['get', 'style'], 'drift'],
      layout: { visibility: nodeLayerOn() ? 'visible' : 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [1, 3] } })
    // One pass puts the stack in its declared order (#626), whatever order the
    // adds ran in. Moving each present layer to the top in LAYER_ORDER leaves
    // them exactly as declared, and repairs a stack built across two runs on a
    // half-applied style. The basemap's own layers are not in the list, so they
    // keep their places underneath.
    for (const id of LAYER_ORDER) if (map.getLayer(id)) map.moveLayer(id)
    rays.addTo(map)
    rays.setVisible(coverageOn() && mode3D)
    draw()
  }
  // Initial style: 'load' fires once when the first style is ready. A theme
  // switch (setStyle) does NOT re-fire 'load'/'style.load' — only 'styledata' —
  // so applyBasemap re-adds the overlays via afterStyle once the new style
  // finishes. addOverlays is idempotent (guards on existing source/layer).
  // afterStyle runs cb once the new style can take layers. That is 'styledata',
  // not 'idle' (#626). Measured against the bundled 4.7.1 with a style whose
  // sources never answer: 'styledata' fires once at +23..31 ms with
  // isStyleLoaded() false, and addSource/addLayer there succeed — while
  // isStyleLoaded() never goes true and 'idle' never fires at all, because both
  // wait on the sources rather than on the style. Waiting for 'idle' is what
  // left the map on a flat background for twelve seconds on a slow link.
  //
  // No guard against the OLD style is needed: 'styledata' cannot fire before
  // setStyle has begun applying, unlike isStyleLoaded(), which reads true for
  // the previous style right up until it does.
  function afterStyle(cb) { map.once('styledata', cb) }
  // mountBare adds the overlays onto the inline bare fallback style. An inline
  // style applies SYNCHRONOUSLY and emits no styledata/idle/style.load event
  // (and the map never reaches 'idle' when it got here stuck mid-load), so poll
  // isStyleLoaded() — which is immediately true — rather than waiting on a hook.
  function mountBare() { if (map.isStyleLoaded()) addOverlays(); else setTimeout(mountBare, 100) }
  map.on('load', addOverlays)
  armStyleFallback()   // safety net if the initial hosted style never loads

  // Point tap → open popup + roll the receptions-log playhead (#130). Registered
  // once; fires only while the 'points'/'points-3d' layer exists. Bound to
  // both layers (#250) — whichever one is visible for the current 2D/3D mode
  // is the one that can actually receive the click.
  function onPointClick(e) {
    const f = e.features && e.features[0]; if (!f) return
    const r = lastRecords.find((x) => String(x.id) === String(f.properties.id)); if (!r) return
    if (onMarkerFocusCb) onMarkerFocusCb(r)
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
      .setLngLat([r.lon, r.lat]).setHTML(popupHtml(r, lastSelected)).addTo(map)
    wireIsolate(popup, r); wireIgnore(popup, r)
  }
  // A tap on bare map clears the coverage selection (#603); marker taps stop
  // their own propagation and never land here.
  map.on('click', (e) => {
    if (!coverageSel.size) return
    const layers = ['points', 'points-3d', 'hex', 'hex-3d'].filter((id) => map.getLayer(id))
    if (!map.queryRenderedFeatures(e.point, { layers }).length) clearCoverageSelection()
  })
  for (const layerId of ['points', 'points-3d']) {
    map.on('click', layerId, onPointClick)
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
  }

  // MapLibre latches onto its 400×300 zero-size fallback when the map is built
  // before #map has laid out — a backgrounded tab, a PWA cold start, or (here)
  // creation after `await loadConfig()` in DOMContentLoaded. Its own resize
  // tracking doesn't reliably clear that initial latch, so the map renders in a
  // corner (or blank), and any later camera move — notably the 3D toggle's
  // pitch easeTo — just repaints at the wrong size. Reconcile the canvas to
  // its container whenever they disagree; cheap enough to run each render tick.
  function syncSize() {
    const c = map.getContainer(), cv = map.getCanvas()
    if (c.clientWidth && c.clientHeight &&
        (Math.abs(cv.clientWidth - c.clientWidth) > 1 || Math.abs(cv.clientHeight - c.clientHeight) > 1)) {
      map.resize()
    }
  }

  function draw() {
    syncSize()
    if (!map.getSource('points')) return   // style not ready yet
    const records = lastRecords
    // Build only what a visible layer will read (#266). Previously all three
    // were rebuilt and re-uploaded every 1 Hz tick regardless of mode, so one
    // of the two point collections was always tessellated and shipped to the
    // GPU for a layer set to visibility:none. hex and hex-3d share one source,
    // so it is built when either is on.
    const vis = layerVisibility({ mode, mode3D })
    const cov = drawCoverage(records)
    // With a star selected, the rest of the map steps back, not only the other
    // stars (#624). null outside the reach stop, since drawCoverage answers
    // null there, so nothing dims unless the reach is on. The selected ids and
    // the stars they select (starSelected), so a hearing reach placed on the
    // node of a picked relay id stays lit with its star (#661).
    const sel = cov ? new Set([...cov.selected, ...cov.selectedStars]) : null
    // Which star each reception belongs to, for the cache keys (ownersKey).
    // Only the reach stop reads it: outside it no dot takes a star's hue and
    // nothing dims, so the fold is skipped there.
    const owners = cov ? ownersKey(records, ownerOf) : ''
    map.getSource('hex').setData(vis.hex || vis['hex-3d'] ? buildHexFC(records, sel, owners) : EMPTY)
    map.getSource('points').setData(vis.points ? buildPointsFC(records, sel, owners) : EMPTY)
    map.getSource('points-3d').setData(vis['points-3d'] ? buildPoints3DFC(records, sel, owners) : EMPTY)
    map.getSource('trail').setData(buildTrailFC())
    // The trail belongs to no repeater, so it is never part of a selection and
    // always steps back with one. One LineString with no properties, so this
    // is the layer's paint, not a feature value.
    if (map.getLayer('trail')) map.setPaintProperty('trail', 'line-opacity', TRAIL_OPACITY * selectionDim(sel))
    map.getSource('highlight').setData(buildHighlightFC())
    map.getSource('here').setData(buildHereFC())
    drawNodeLayer(records, cov)
    drawHexLabels(records, vis['hex-labels'])
  }

  // ---- hex labels (#556) ----
  // Who was heard in a cell, as id prefixes (hexlabels.js decides the text),
  // drawn as HTML markers like the node layer: the bare fallback style has no
  // glyphs, so a symbol layer would draw nothing there. Only from
  // HEX_LABEL_MIN_ZOOM and only for cells in view. One marker per cell id,
  // kept while the cell stays in view: planHexLabels decides which markers a
  // draw adds, relabels or removes, so a new reception in one cell touches
  // that cell's marker and a tick that changes nothing touches none.
  const hexLabelMarkers = new Map()   // cell id -> marker
  function clearHexLabels() {
    hexLabelMarkers.forEach((m) => m.remove()); hexLabelMarkers.clear()
  }
  function drawHexLabels(records, on) {
    if (!on || !showHexLabels(map.getZoom())) { if (hexLabelMarkers.size) clearHexLabels(); return }
    const res = hexResForZoom(map.getZoom())
    const b = map.getBounds()
    const cells = new Map()
    for (const r of records) {
      if (r.lat == null || r.lon == null) continue
      if (r.lat < b.getSouth() || r.lat > b.getNorth() || r.lon < b.getWest() || r.lon > b.getEast()) continue
      const id = hexCellAt(r.lat, r.lon, res)
      const cur = cells.get(id) || []
      cur.push(r); cells.set(id, cur)
    }
    const items = []
    for (const [id, rows] of cells) {
      const label = hexCellLabel(rows)
      if (!label) continue
      const ring = hexBoundary(id); if (!ring) continue
      let lat = 0, lon = 0
      const n = ring.length - 1   // closed ring: the last vertex repeats the first
      for (let i = 0; i < n; i++) { lat += ring[i][0]; lon += ring[i][1] }
      items.push({ id, label, lat: lat / n, lon: lon / n })
    }
    const drawn = new Map([...hexLabelMarkers].map(([id, m]) => [id, m.getElement().textContent]))
    const { add, relabel, remove } = planHexLabels(drawn, items)
    for (const id of remove) { hexLabelMarkers.get(id).remove(); hexLabelMarkers.delete(id) }
    for (const it of relabel) hexLabelMarkers.get(it.id).getElement().textContent = it.label
    for (const it of add) {
      const el = document.createElement('div')
      el.className = 'hex-label'
      el.textContent = it.label
      hexLabelMarkers.set(it.id, new maplibregl.Marker({ element: el }).setLngLat([it.lon, it.lat]).addTo(map))
    }
  }

  // ---- pulse (#556) ----
  // About two seconds on the reception that just arrived, in its tier colour,
  // whatever the zoom, and only where receptions are drawn (layerVisibility):
  // nothing in hex mode, which draws none, and no animation started for a
  // hidden layer. Driven by a timer rather than requestAnimationFrame so it
  // also runs while the page is not painting.
  const PULSE_MS = 1600, PULSE_STEP_MS = 40, PULSE_FROM_PX = 8, PULSE_TO_PX = 24
  // The 3D flash stands 2% wider than the pillar it marks, and that is not
  // decoration. Two fill-extrusions with the same footprint share one depth
  // pass and the pillar wins every pixel of the tie, so a flash on exactly the
  // pillar's own octagon is invisible -- measured in MapLibre 4.7.1 on
  // 2026-09-14, at every opacity from 0.05 to 1. 2% clears the depth test
  // outright and is well under a pixel on screen at any zoom the pillars are
  // drawn at, so what flashes still reads as the pillar and not as a second
  // shape around it.
  const PULSE_3D_SWELL = 1.02
  let pulseTimer = null
  function pulse(rec) {
    if (!rec || rec.lat == null || rec.lon == null) return
    // One form per dimension (#648, maplayers.js): the ring where the flat dots
    // are, the pillar flash where they are pillars. Neither in hex mode, which
    // draws no receptions to mark.
    const vis = layerVisibility({ mode, mode3D })
    const id = vis.pulse ? 'pulse' : vis['pulse-3d'] ? 'pulse-3d' : null
    if (!id || !map.getSource(id) || !map.getLayer(id)) return
    if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null }
    const tier = rssiTier(rec.rssi, currentOffset())
    const color = cssVar(tierColorVar(tier))
    // Where the flash travels from and where it lands: opaque white the moment
    // the reception arrives, and by the end the pillar's exact colour -- the
    // same token, pre-mixed over the same background, at the same tier opacity
    // buildPoints3DFC paints it with. Ending exactly there is what makes the
    // handoff invisible: the flash's last frame and the pillar underneath it
    // are the same colour, so clearing the source changes nothing on screen.
    // Opaque and pre-mixed for the reason the pillars are (#412, #647), and it
    // has to move with them or that handoff stops being seamless. A reception
    // that just arrived belongs to this ride by definition, so it lands on the
    // tier's own opacity and never on the backlog value.
    const flash3DColor = (t) => tintOver(tintOver('#ffffff', color, 1 - t), cssVar('--ch-bg'), fillOpacity(tier) + (1 - fillOpacity(tier)) * (1 - t))
    map.getSource(id).setData(id === 'pulse'
      ? fc([{ type: 'Feature', geometry: { type: 'Point', coordinates: [rec.lon, rec.lat] }, properties: { color } }])
      // The octagon the reception's own pillar stands on, swelled by a couple
      // of percent, so the flash is that pillar lighting up rather than a
      // second shape beside it. Same height, which needs no swell: the wider
      // footprint already takes the depth test.
      : fc([{ type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [octagonRing(rec.lat, rec.lon, pillarRadiusM(rec.lat, map.getZoom(), POINT_PILLAR_RADIUS_M, POINT_PILLAR_MIN_RADIUS_PX) * PULSE_3D_SWELL)] },
        properties: { color: flash3DColor(0), height: extrusionHeight(rec.rssi, currentOffset()) } }]))
    const started = Date.now()
    const step = () => {
      const t = Math.min(1, (Date.now() - started) / PULSE_MS)
      if (!map.getLayer(id)) { clearInterval(pulseTimer); pulseTimer = null; return }
      if (id === 'pulse') {
        map.setPaintProperty('pulse', 'circle-radius', PULSE_FROM_PX + (PULSE_TO_PX - PULSE_FROM_PX) * t)
        map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.9 * (1 - t))
      } else {
        // Colour, not opacity. A fill-extrusion writes depth even where it is
        // translucent, so fading the flash's alpha never reveals the pillar
        // behind it: it dissolves the flash toward the background instead,
        // leaving a hole where the pillar should be, and the pillar snaps back
        // only when the alpha reaches exactly 0 (measured, same probe as the
        // swell above). Settling onto the pillar's own colour has none of that.
        // A constant here replaces the layer's ['get', 'color'], which is what
        // paints the first frame; the layer only ever holds this one feature.
        map.setPaintProperty('pulse-3d', 'fill-extrusion-color', flash3DColor(t))
      }
      if (t >= 1) { clearInterval(pulseTimer); pulseTimer = null; map.getSource(id).setData(EMPTY) }
    }
    step()
    pulseTimer = setInterval(step, PULSE_STEP_MS)
  }

  // ---- node-position layer (#197) ----
  // Colour encodes only what the rules decide, never a judgement about which
  // position is "right": the advertised one is operator-self-reported and can
  // be stale, so a gap is drift, not error.
  function driftColor(p) {
    if (p.kind === 'tight') return cssVar('--ch-accent')
    if (p.kind === 'drifted' && p.outsideCircle) return cssVar('--ch-accent-2')
    return cssVar('--ch-muted')
  }

  // The name rides alongside the ▲ rather than only inside the popup: this
  // layer is opt-in, so the map can afford the labels while it is on. The
  // label is absolutely positioned so it never shifts the glyph off the
  // coordinate the marker is anchored to.
  function nodeMarkerEl(cls, glyph, label) {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const el = document.createElement('div')
    const name = label ? `<span class="np-label">${esc(label)}</span>` : ''
    el.innerHTML = `<div class="${cls}">${glyph}${name}</div>`
    return el
  }

  // A Marker built from a custom element does not toggle its popup on tap by
  // itself, so wire the click explicitly.
  // With the reach on, a repeater's ▲ takes the hue of its star, a selected
  // one carries its name in a pill, the others dim with their stars, and a
  // tap selects (#603); the popup still opens.
  function addNodeMarker(cls, glyph, lngLat, popup, label, { color = null, selected = false, dim = false, onTap = null } = {}) {
    const el = nodeMarkerEl(cls, glyph, label)
    const inner = el.firstElementChild
    if (color) inner.style.color = color
    if (selected) inner.classList.add('np-selected')
    if (dim) inner.classList.add('np-dim')
    const marker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).setPopup(popup).addTo(map)
    // A selecting tap redraws the node layer, which removes this very marker,
    // so toggling its popup afterwards would open it on a marker already gone.
    // That tap sets reopenNodeKey instead and drawNodeLayer reopens the popup
    // on the rebuilt marker (#623). A tap with nothing to select just toggles.
    el.addEventListener('click', (e) => { e.stopPropagation(); if (onTap) onTap(); else marker.togglePopup() })
    nodeMarkers.push(marker)
    return marker
  }

  // Recomputed per tick: the visible node set follows the viewport, and each
  // node's estimate follows whatever receptions are currently plotted.
  // Signature guards (like web/map.js) prevent popup flicker on every 1Hz render.
  function drawNodeLayer(records, cov) {
    if (!map.getSource('nodedrift')) return
    if (!nodeLayerOn()) {
      map.getSource('nodedrift').setData(EMPTY)
      map.getSource('nodecircle').setData(EMPTY)
      nodeMarkers.forEach((m) => m.remove()); nodeMarkers = []
      return
    }

    const b = map.getBounds()
    const bounds = { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() }
    const draw = []

    // Registry nodes in view: advertised position, plus our estimate when we
    // have heard them enough to produce one. Match sender_id (from receptions)
    // against node pubkey: exact match for advert_pubkey, prefix match for
    // discover_pubkey, never for a channel_name (#197/#272). One pass over the
    // records for the whole in-view set, not one pass per node: this also lets
    // an id that matches two nodes be refused outright rather than attributed
    // to both (#295). A relay, path or direct hash joins a node through its
    // attribution by reach instead (#661), worked out by app.js against every
    // candidate of the companion's SF, so a second candidate out of view still
    // refuses it.
    const inView = nodesInView(nodePositions, bounds)
    const byNode = groupSenderPointsForNodes(records, inView, { attributionOf })
    for (const n of inView) {
      const pts = byNode.get(String(n.pubkey).toLowerCase()) || []
      const est = pts.length ? estimateFor(pts) : null
      const p = driftPresentation({ advertised: n, estimate: est })
      if (p.kind === 'none') continue
      draw.push({ n, est, p })
    }

    // Screen-space label declutter (#539, the map's #425 taken verbatim):
    // walk the nodes in a stable id order and keep a name only where its
    // measured box is clear of the ones already kept. The ▲ always stays and
    // the name is still in the popup. Recomputed per draw, so zooming in
    // separates the projected points and names come forward on their own —
    // and at a steep 3D pitch map.project answers through the tilted camera,
    // so the boxes are where the labels actually paint.
    const labelled = new Set(unclutteredLabels(
      [...draw]
        .sort((a, b) => (a.n.pubkey < b.n.pubkey ? -1 : a.n.pubkey > b.n.pubkey ? 1 : 0))
        .map((d) => {
          const pt = map.project([d.n.lon, d.n.lat])
          return { id: d.n.pubkey, x: pt.x, y: pt.y, label: d.n.name || d.n.pubkey }
        }),
      { measure: labelMeasurer() },
    ))

    // Compute signature of what would be drawn — if unchanged, skip rebuild to preserve open popups
    const sig = draw.map((d) => [d.n.pubkey, d.n.lat, d.n.lon, d.p.kind, Math.round(d.p.driftM ?? -1),
      Math.round(d.p.circle ? d.p.circle.radiusM : -1),
      d.est ? `${d.est.centroid.lat.toFixed(5)},${d.est.centroid.lon.toFixed(5)}` : ''].join(':')).join('|')
      // The label set depends on the projection, not the rows: a zoom that
      // changes no node still changes which names fit (#539). Without it in
      // the signature the early return would freeze the previous zoom's set.
      + '#' + [...labelled].join(',')
      // The hues and the selection are part of what the markers show (#603).
      + (cov ? '#reach:' + cov.count + ':' + [...cov.selected].join(',') + ':' + [...cov.selectedStars].join(',') + ':' + [...coverageHue].map(([k, v]) => k.slice(0, 8) + v).join(',') : '')
    if (sig === nodePosSig) return   // nothing changed — leave the layer (and any open popup) alone
    nodePosSig = sig

    const lines = [], circles = []
    nodeMarkers.forEach((m) => m.remove()); nodeMarkers = []

    for (const { n, est, p } of draw) {
      const color = driftColor(p)
      // Only the ▲ is labelled — the ● belongs to the same node, so naming
      // both would just double the text for one target — and only where the
      // declutter kept the name (#539).
      const key = String(n.pubkey).toLowerCase()
      const hue = coverageHue.get(key) || null
      // Every repeater is selectable in the reach stop, star or no star (#623).
      // The gate used to be `hue`, which did two jobs: it hid the tap from a
      // repeater with no hearings this tick, and it stood in for "the reach is
      // on", since coverageHue is empty outside it. coverageOn() now says the
      // second directly, and the first is gone. A repeater with no hearings is
      // a valid selection: nothing draws from it, everything else dims, and its
      // popup says why. The dim loses its `hue` term for the same reason.
      const reachOn = coverageOn()
      // Picked directly, or through a relay id placed on this node by reach
      // (starSelected, #661), so a ▲ whose star was picked by that id is not dimmed.
      const selected = !!(cov && (cov.selected.has(key) || cov.selectedStars.has(key)))
      // The popup's button reads the node's own key only: a press adds or
      // removes that key (toggleCoverageSelection), so a star selected through
      // a picked relay id offers "Show reach", not a "Hide reach" it cannot keep.
      const picked = !!(cov && cov.selected.has(key))
      const tap = reachOn ? () => { reopenNodeKey = key; toggleCoverageSelection(key) } : null
      const popupFor = () => nodePopup(n, p, est, { key, reachOn, selected: picked, heard: !!hue })
      const adv = addNodeMarker('np-advert', '▲', [n.lon, n.lat], popupFor(), labelled.has(n.pubkey) ? (n.name || n.pubkey) : null,
        { color: hue, selected, dim: !!(cov && cov.selected.size && !selected), onTap: tap })
      // Only on the ▲, so a tap on the ● does not leave two popups open.
      if (reopenNodeKey === key) adv.togglePopup()
      if (!est || !est.centroid) continue
      // The ● is the same repeater, so it selects the same star (coverage log,
      // decision 6: a tap on a repeater's ▲ or ● selects it).
      addNodeMarker('np-estimate', '', [est.centroid.lon, est.centroid.lat], popupFor(), null, { onTap: tap })
      lines.push({ type: 'Feature', properties: { color },
        geometry: { type: 'LineString', coordinates: [[n.lon, n.lat], [est.centroid.lon, est.centroid.lat]] } })
      if (p.circle) {
        const ring = circleRing(est.centroid, p.circle.radiusM)
        if (ring.length) circles.push({ type: 'Feature', properties: { color, style: p.circle.kind },
          geometry: { type: 'LineString', coordinates: ring } })
      }
    }
    // Cleared whether or not it matched: a repeater that scrolled out of view
    // between the tap and the redraw must not pop its popup open the next time
    // it comes back.
    reopenNodeKey = null
    map.getSource('nodedrift').setData(fc(lines))
    map.getSource('nodecircle').setData(fc(circles))
  }

  function nodePopup(n, p, est, { key = null, reachOn = false, selected = false, heard = false } = {}) {
    const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    // The glyph meaning lives here since #631: this line names the glyphs drawn
    // for this node, and no sentence under it repeats that positions are
    // inferred (#662).
    const markers = p.kind === 'advertised-only' ? '▲ advertised' : '▲ advertised · ● estimated'
    // "no estimate" is not the same as "not heard" (#272). An advert or a
    // discover reply names the node outright, and a relayed reception joins
    // it when this is the one node with that prefix in reach (#661). A relayed
    // reception with a second candidate in reach belongs to no node, and an
    // estimate needs 3 receptions at separate spots, so a node heard often can
    // still have none; claiming it was never heard would be wrong.
    const drift = p.driftM != null
      ? `<br>drift ${Math.round(p.driftM)} m · ${est ? est.n : 0} points`
      : '<br>no estimate: too few of your receptions at separate spots belong to this node'
    // The circle only claims accuracy when the sampling geometry earned it;
    // say which of the two is being drawn so the map is self-explaining.
    const circle = p.circle
      ? `<br><span class="np-muted">${p.circle.kind === 'search'
          ? `search radius ~${Math.round(p.circle.radiusM)} m`
          : 'one-sided — radius not trusted'}</span>`
      : ''
    // The reach action (#623), back in the popup where every other per-node
    // action lives. #603 retired #549's per-node buttons when the layer began
    // drawing every star at once, which left selecting a star an undiscoverable
    // tap. Only in the reach stop, where a selection means something. It says
    // what a press will do, so a selected repeater offers to hide its reach.
    const reach = reachOn
      ? `<br><button class="ch-reach${selected ? ' active' : ''}">${selected ? 'Hide reach' : 'Show reach'}</button>`
        + (heard ? '' : '<br><span class="np-muted">No hearings in this window yet, so there is no reach to draw.</span>')
      : ''
    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '260px' })
      .setHTML(`<div class="ch-popup">${esc(n.name || n.pubkey)}<br>`
        + `<span class="np-muted">${markers}</span>${drift}${circle}${reach}</div>`)
    // The popup's DOM exists only once it opens, so the button is wired then,
    // the way wireIsolate wires a reception popup's buttons.
    if (reachOn && key) popup.on('open', () => {
      const btn = popup.getElement()?.querySelector('.ch-reach')
      if (btn) btn.onclick = () => { reopenNodeKey = key; toggleCoverageSelection(key) }
    })
    return popup
  }

  // ---- public API (unchanged from the Leaflet version) ----
  // reachRows (#603): the sender-free rows the stars are built from while a
  // target narrows the plotted set; null means the plotted set is the set.
  function render(records, selectedIds, reachRows = null) { lastRecords = records || []; lastSelected = selectedIds || null; lastReachRows = reachRows; draw() }
  function setHighlight(id) { highlightId = id == null ? null : id; if (map.getSource('highlight')) map.getSource('highlight').setData(buildHighlightFC()) }
  function onMarkerFocus(cb) { onMarkerFocusCb = cb }
  function setPosition(lat, lon) {
    lastPos = [lat, lon]
    const next = appendTrailPoint(trail, lat, lon)
    if (next !== trail) { trail = next; if (map.getSource('trail')) map.getSource('trail').setData(buildTrailFC()) }
    if (map.getSource('here')) map.getSource('here').setData(buildHereFC())
    // jumpTo is an instant, non-animated camera set — calling it while the
    // user has an active gesture (e.g. pinch-zoom) in progress interrupts
    // MapLibre's own interaction handler and cancels the gesture (#236: this
    // is why pinch-to-zoom didn't work while compass mode was following). A
    // GPS fix landing mid-pinch now just skips this recenter; the next fix
    // (or the user releasing the gesture) catches up.
    if (follow && !map.isZooming() && !map.isMoving()) {
      map.jumpTo({ center: [lon, lat], zoom: acquired ? map.getZoom() : ACQUIRE_ZOOM })
      acquired = true
    }
  }
  function centerOn(lat, lon) { map.easeTo({ center: [lon, lat], duration: 400 }) }
  // Eases rather than jumps (#403): with padding in play a jump would land on
  // the offset position in one frame, and the ease is what tells the hand
  // where the map went. The follow callback runs before the ease: it sets the
  // look-ahead padding (updateCompassIcon), which the ease has to read. Set
  // during the ease it stopped the ease dead (measured), and now that
  // applyPadding holds a write while the map moves it would land at moveend,
  // with the ease aiming at the un-offset centre.
  // Before the first fix there is nowhere to ease to; follow still comes on,
  // and setPosition centres the map on that fix when it lands.
  function recenter() { setFollow('follow'); if (lastPos) map.easeTo({ center: [lastPos[1], lastPos[0]], duration: 400 }) }
  function onFollowChange(cb) { onFollow = cb }
  function setBearing(deg) { settingBearing = true; try { map.setBearing(deg) } finally { settingBearing = false } }
  function onGestureRotate(cb) { rotateCb = cb }
  // Applies the current layer decision to the live style. Both the layer-mode
  // switch and the 3D toggle need it: in 3D the mode decides whether hex is
  // drawn flat (under the pillars) or extruded (#266).
  function applyLayerVisibility() {
    const vis = layerVisibility({ mode, mode3D })
    // Every layer layerVisibility decides, or the FAB and the style load
    // disagree again — the exact drift #266 pulled the decision out for. The
    // 3D pulse is the one that shows it: it loads 'none' in 2D, so a tap into
    // 3D that skipped it would leave the flash off until the next style load.
    for (const id of ['hex', 'hex-3d', 'points', 'points-3d', 'pulse', 'pulse-3d']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis[id] ? 'visible' : 'none')
    }
  }
  // setView(m, v) — the view FAB's one entry point (#336). The layer mode and
  // the 2D/3D flag used to be set through two methods, each doing its own
  // applyLayerVisibility() + draw(), so a single tap ran two full
  // tessellate-and-upload passes over the whole record set. Nothing painted in
  // between (both were synchronous within one task), so it was invisible — but
  // it doubled the work on the one control designed to be used one-handed
  // while driving. Assign both, then apply once.
  // Pitch: only a tap that crosses the 2D/3D line moves the camera
  // (pitchTransition, maplayers.js). Easing on every tap threw away any angle
  // the tilt gesture had set, which is three of the five steps in the cycle.
  function setView(m, v) {
    const was3D = mode3D
    mode = m
    mode3D = !!v
    applyLayerVisibility()
    const pitch = pitchTransition(was3D, mode3D)
    // easeTo({pitch}) is a no-op while a mesh is set (docs/2026-07-11-3d-mode.md),
    // so the mesh comes off before the tilt back, and goes on after the tilt
    // up has settled; the plan itself (mode3D) is what decides either way.
    if (pitch !== null) {
      if (!mode3D) applyTerrain()
      map.easeTo({ pitch, duration: 500 })
      if (mode3D) map.once('moveend', applyTerrain)
    } else applyTerrain()
    // draw() is needed even when only the flag changed: the hidden collection's
    // source is left at EMPTY (that is the point of the per-tick build guard),
    // so revealing it without repopulating shows nothing until the next 1 Hz tick.
    draw()
    if (map.getLayer('buildings-3d')) map.setLayoutProperty('buildings-3d', 'visibility', mode3D ? 'visible' : 'none')
    applyReachVisibility()
  }
  // Node-position layer (#197): the registry set is fetched once by app.js and
  // handed over whole; bounds filtering happens here per tick.
  function setNodePositions(nodes) { nodePositions = Array.isArray(nodes) ? nodes : []; draw() }
  // The layer's stop (nodeposmode.js): off, positions, or positions + reach.
  function setNodeLayer(m) {
    nodeLayerMode = m === 'reach' || m === 'positions' ? m : 'off'
    if (!coverageOn()) coverageSel.clear()
    for (const id of ['nodedrift', 'nodecircle-search', 'nodecircle-drift']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', nodeLayerOn() ? 'visible' : 'none')
    }
    applyReachVisibility()
    nodePosSig = null
    draw()
  }
  function setAttenuator(db) { attenuatorDb = Number(db) || 0; draw() }
  // Re-add the overlays after the style swap, with the safety net armed again.
  // styleAttempt resets: this swap gets its own retry before the bare fallback.
  function applyBasemap() { overlaysReady = false; styleAttempt = 0; map.setStyle(styleFor()); afterStyle(addOverlays); armStyleFallback() }
  // Pan to a reception, no popup: the ticker row that triggers this (#309) sits
  // over the map on a phone, and a popup on top of it would cover the very list
  // the user is scrubbing. The highlight ring (setHighlight, driven by the
  // ticker's own onActiveChange) is what marks the record; this only moves the
  // camera there. A record with no fix is silently ignored — its point is not
  // on the map to pan to.
  function focusReception(rec) {
    if (!rec || rec.lat == null || rec.lon == null) return
    lookAway()
    centerOn(rec.lat, rec.lon)
  }
  function destroy() { clearInterval(skyTimer); clearTimeout(styleTimer); if (pulseTimer) clearInterval(pulseTimer); clearHexLabels(); map.remove() }
  return { setPosition, centerOn, recenter, onFollowChange, render, setView, applyBasemap, focusReception, setAttenuator, setBearing, onGestureRotate, setHighlight, onMarkerFocus, setNodePositions, releaseFollow, setLookAhead, setNodeLayer, setExaggeration, pulse, destroy }
}

// popupHtml is the point popup's markup, exported for its test.
export function popupHtml(r, selectedIds) {
  const esc = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  // Glossary (#174): 'sender' is the general term for a heard device, 'repeater'
  // for one known to be relaying (not originating) traffic. `relay` here is the
  // internal sender_kind value (meshpacket.js) -- only its display label changed.
  // A path_hash is a relay hop too, with a 1-byte id.
  const kindLabel = { channel_name: 'name', advert_pubkey: 'sender', discover_pubkey: 'sender', relay: 'repeater', path_hash: 'repeater' }[r.sender_kind] || 'sender'
  // senderText, the ticker's name: a 1-byte hash reads '#' and its id unless
  // its attribution by reach places it on a named node (#661).
  const senderLine = r.sender_id ? `${kindLabel} ${esc(senderText(r))}` : 'sender (none)'
  const chanLine = r.channel_name ? `<br>channel ${esc(r.channel_name)}` : ''
  const textLine = r._text ? `<br>"${esc(r._text)}"` : ''
  const key = r.sender_id ? String(r.sender_id).toLowerCase() : null
  const sole = !!(key && selectedIds && selectedIds.size === 1 && selectedIds.has(key))
  const isolateBtn = sole
    ? `<button class="ch-isolate active" disabled>Isolated ✓</button>`
    : `<button class="ch-isolate" ${r.sender_id ? '' : 'disabled'}>Isolate sender</button>`
  return `<div class="ch-popup">RSSI ${esc(r.rssi)} · SNR ${esc(r.snr)}<br>`
    + `${esc(packetTypeLabel(r.packet_type))}<br>`
    + senderLine + chanLine + textLine + '<br>'
    + isolateBtn
    + ` <button class="ch-ignore" ${r.sender_id ? '' : 'disabled'}>Ignore this ID</button></div>`
}
function wireIsolate(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-isolate')
  if (!btn || !r.sender_id || btn.disabled) return
  btn.onclick = () => {
    // pickName: a 1-byte hash selects every reception with that id, so the
    // chip reads '#' and the id rather than the node this one was placed on.
    document.dispatchEvent(new CustomEvent('hunt:isolate-sender', { detail: { id: r.sender_id, label: pickName(r) } }))
    btn.textContent = 'Isolated ✓'; btn.disabled = true; btn.classList.add('active')
  }
}
function wireIgnore(popup, r) {
  const btn = popup.getElement()?.querySelector('.ch-ignore')
  if (btn && r.sender_id) btn.onclick = () => document.dispatchEvent(new CustomEvent('hunt:ignore-sender', { detail: { id: r.sender_id } }))
}
