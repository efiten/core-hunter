/* global maplibregl */
// The map itself (#465): MapLibre GL, the app's map (app/src/huntmap.js),
// on the website. What is here is the WebGL and DOM glue: the basemap and
// its fallback, the sources and layers the data goes into, markers, popups,
// and the few camera calls map.js makes. What goes into the layers is built
// in mapmodel.js, which the unit suite covers.
//
// Ported from the app's map rather than written fresh, so the two surfaces
// share one basemap (OpenFreeMap, key-free), one fallback (a bare background
// style that needs no network, so the data survives the basemap being down),
// one sky and one way of surviving a style swap: every overlay is re-added
// from addOverlays on each style load, since setStyle drops them.
//
// 3D (#595) is the app's 3D whole: the camera rotates and tilts, hex-3d and
// points-3d are the extruded twins of the flat layers, buildings come from
// the hosted style's own vector source, and the terrain rides with the 3D
// view. Which layers a view shows is maplayers.js; the terrain plan is
// terrain.js; both are the app's files, pinned byte for byte.
import { skyForHour, currentHour } from './sky.js'
import { layerVisibility, pitchTransition } from './maplayers.js'
import { EXTRUSION_LIGHT_INTENSITY } from './signal.js'
import { DEM_TILES, DEM_ENCODING, DEM_MAX_ZOOM, DEM_ATTRIBUTION, DEFAULT_EXAGGERATION, hillshadeFor, terrainPlan } from './terrain.js'

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
}
const EMPTY = { type: 'FeatureCollection', features: [] }
const bareStyle = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] })
// The sources the data layers read, all GeoJSON, all set through setData.
const GEO_SOURCES = ['hex', 'points', 'points-3d', 'observer-advert', 'observer-rxlog', 'locate-in', 'locate-out', 'rxhighlight', 'nodedrift', 'nodecircle']
// The app's ceiling (huntmap.js MAX_PITCH): a near-horizontal camera for the
// tilt gesture; the view button itself eases to PITCH_3D (maplayers.js).
const MAX_PITCH = 85

export function createWebMap(containerId, { center, zoom, theme = 'dark', mode = 'hex', mode3D = false, pitch = 0, bearing = 0, exaggeration = DEFAULT_EXAGGERATION } = {}) {
  const map = new maplibregl.Map({
    container: containerId, style: STYLES[theme] || STYLES.dark,
    center: [center[1], center[0]], zoom, pitch, bearing,
    // Rotation and tilt on, as in the app (#595): dragRotate is the right
    // or ctrl drag, pitchWithRotate the mouse tilt on the same drag, and
    // touch pitch is a separate handler that defaults on.
    attributionControl: false, dragRotate: true, pitchWithRotate: true, maxPitch: MAX_PITCH,
  })
  // The compass draws the bearing and the pitch, and a click puts north back
  // up and the camera flat: MapLibre's own control, in the house colours
  // (style.css). The app's compass button cycles through following the
  // phone, which the site has nothing to follow (#403); this is the rest.
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-left')
  map.addControl(new maplibregl.AttributionControl({ compact: true }))

  let currentTheme = theme
  // The view (#595): the layer mode map.js owns, and whether the view is 3D.
  // Both go through setView, the app's one entry point (huntmap.js), so a
  // style reload and a button press cannot disagree about what is on screen.
  let layerMode = mode, is3D = !!mode3D
  // Terrain (#396, riding with the 3D view on both surfaces, Kasper
  // 2026-09-06): the exaggeration from Settings, and demReady, which flips
  // once the DEM source has tiles for the view; until then the map stays
  // flat. Reset on every style load, since setStyle drops the source.
  let terrainExag = exaggeration, demReady = false
  map.on('sourcedata', (e) => {
    if (e.sourceId === 'dem' && e.isSourceLoaded && !demReady) { demReady = true; applyTerrain() }
  })
  // A DEM tile that fails is a tile that never arrives: the map stays flat
  // rather than stalled, and the console is spared one error per tile.
  map.on('error', (e) => { if (e && e.sourceId === 'dem') e.preventDefault && e.preventDefault() })
  let overlaysReady = false, styleTimer = null
  const readyCbs = []
  // Pending data, applied once the layers exist: a caller that draws before
  // the style has loaded (the first refresh lands before 'load') must not
  // lose its answer, so each source remembers the last collection it was
  // handed and addOverlays replays it.
  const pending = new Map()
  let heat = null   // { url, coordinates } for the locate density image

  function armStyleFallback() {
    clearTimeout(styleTimer)
    styleTimer = setTimeout(() => {
      // Hosted style never mounted the overlays (offline / host down): drop to
      // a bare background so the data still shows, as the app does.
      if (!overlaysReady) { map.setStyle(bareStyle(cssVar('--ch-bg'))); mountBare() }
    }, 12000)
  }
  function applySky() {
    if (typeof map.setSky !== 'function' || !map.isStyleLoaded()) return
    map.setSky(skyForHour(currentHour(), currentTheme))
  }
  const skyTimer = setInterval(applySky, 60000)

  // ensureDem mounts the DEM source and the hillshade layer under the data
  // overlays (before 'hex', the first of them), on the current style.
  function ensureDem() {
    if (!map.getSource('dem')) {
      map.addSource('dem', { type: 'raster-dem', tileSize: 256, maxzoom: DEM_MAX_ZOOM, encoding: DEM_ENCODING, tiles: [DEM_TILES], attribution: DEM_ATTRIBUTION })
    }
    if (!map.getLayer('hillshade')) {
      map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
        paint: { 'hillshade-exaggeration': hillshadeFor(terrainExag) } }, map.getLayer('hex') ? 'hex' : undefined)
    }
  }
  // applyTerrain draws the plan for the current state (terrain.js). On the
  // site the 3D view is the terrain switch: shading and mesh both follow it,
  // the mesh once the tiles are in. setTerrain is only called when the plan
  // changes, since each call re-derives the mesh.
  function applyTerrain() {
    // Gated on the overlays being mounted, not on isStyleLoaded(), which
    // stays false while any tile is loading (the app's lesson, #396).
    if (!overlaysReady) return
    const plan = terrainPlan({ on: is3D, ready: demReady, mode3D: is3D, exaggeration: terrainExag })
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

  // One decision for the four signal layers (maplayers.js): flat or extruded
  // hex, flat or pillared points. The outline follows the flat hex, since a
  // bar has edges of its own; buildings follow the 3D view.
  function applyLayerVisibility() {
    const vis = layerVisibility({ mode: layerMode, mode3D: is3D })
    const set = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none') }
    for (const id of ['hex', 'hex-3d', 'points', 'points-3d']) set(id, vis[id])
    set('hex-outline', vis.hex)
    set('buildings-3d', is3D)
  }

  function addOverlays() {
    clearTimeout(styleTimer); overlaysReady = true
    applySky()
    // The style light shades every extrusion face; at MapLibre's default it
    // darkened a bar against its own cell (#412). Re-applied on every style
    // load like the sky, since setStyle drops it.
    if (typeof map.setLight === 'function') map.setLight({ anchor: 'viewport', intensity: EXTRUSION_LIGHT_INTENSITY })
    for (const id of GEO_SOURCES) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: pending.get(id) || EMPTY })
    }
    if (heat && !map.getSource('locate-heat')) map.addSource('locate-heat', { type: 'image', url: heat.url, coordinates: heat.coordinates })
    const vis = layerVisibility({ mode: layerMode, mode3D: is3D })
    const shown = (on) => ({ visibility: on ? 'visible' : 'none' })
    // Bottom to top: the hex heat and its bars, the buildings, the locate
    // cloud, then the dots and pillars, then the lines and rings that must
    // never sink under a hot cell.
    if (!map.getLayer('hex')) map.addLayer({ id: 'hex', type: 'fill', source: 'hex', layout: shown(vis.hex),
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } })
    if (!map.getLayer('hex-outline')) map.addLayer({ id: 'hex-outline', type: 'line', source: 'hex', layout: shown(vis.hex),
      paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.9 } })
    // 3D twin of 'hex': same source, extruded to 'height' by tier, painted
    // 'pillar', the cell's tint pre-mixed over the background (#412), opaque:
    // fill-extrusion-opacity is one number for the layer, and one opacity for
    // every tier made a faint bar a solid block on a 19% cell. No vertical
    // gradient: colour is the signal, and shading read as another tier.
    if (!map.getLayer('hex-3d')) map.addLayer({ id: 'hex-3d', type: 'fill-extrusion', source: 'hex', layout: shown(vis['hex-3d']),
      paint: { 'fill-extrusion-color': ['get', 'pillar'], 'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-vertical-gradient': false, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } })
    // Buildings reuse the hosted style's own vector source, already fetched
    // for the 2D basemap, so 3D adds no request; absent on the bare fallback,
    // hence the guard. minzoom 13 is the floor of OpenFreeMap's building
    // layer. Keeps its gradient: a building is a shape, shading makes it one.
    if (map.getSource('openmaptiles') && !map.getLayer('buildings-3d')) {
      map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        layout: shown(is3D),
        paint: { 'fill-extrusion-color': cssVar('--ch-building'),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 3],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.75 } })
    }
    if (heat && !map.getLayer('locate-heat')) map.addLayer({ id: 'locate-heat', type: 'raster', source: 'locate-heat',
      paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 } })
    if (!map.getLayer('points')) map.addLayer({ id: 'points', type: 'circle', source: 'points', layout: shown(vis.points),
      paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'op'],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1 } })
    // 3D twin of 'points' (#250 in the app): an octagon pillar per reception,
    // tier colour and height as the hex bars, so a point still reads at
    // pitch instead of a flat circle sinking under the bars and buildings.
    // Its own source: Polygon footprints cannot double as Point geometry.
    // Opacity 1: the tier alpha rides in the colour (#302), and a layer-wide
    // value would multiply on top of it.
    if (!map.getLayer('points-3d')) map.addLayer({ id: 'points-3d', type: 'fill-extrusion', source: 'points-3d', layout: shown(vis['points-3d']),
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-vertical-gradient': false, 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 1 } })
    // The two CoreScope layers: an advert is a dot, a relay a ring (fill 0.12,
    // stroke 2), the same distinction the Leaflet layer drew.
    for (const src of ['observer-advert', 'observer-rxlog']) {
      if (!map.getLayer(src)) map.addLayer({ id: src, type: 'circle', source: src,
        paint: { 'circle-radius': ['case', ['==', ['get', 'ring'], 1], 6, 4], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'op'],
          'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['case', ['==', ['get', 'ring'], 1], 2, 1] } })
    }
    if (!map.getLayer('locate-out')) map.addLayer({ id: 'locate-out', type: 'circle', source: 'locate-out',
      paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'op'],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.6 } })
    if (!map.getLayer('locate-in')) map.addLayer({ id: 'locate-in', type: 'circle', source: 'locate-in',
      paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'op'],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1 } })
    // Node-position lines and circles (#197), as in the app: the connector is
    // solid; the circle is dashed for a trusted search radius and dotted for
    // the drift fallback. line-dasharray is not data-driven, hence two layers.
    if (!map.getLayer('nodedrift')) map.addLayer({ id: 'nodedrift', type: 'line', source: 'nodedrift',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9 } })
    if (!map.getLayer('nodecircle-search')) map.addLayer({ id: 'nodecircle-search', type: 'line', source: 'nodecircle',
      filter: ['==', ['get', 'style'], 'search'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [4, 4] } })
    if (!map.getLayer('nodecircle-drift')) map.addLayer({ id: 'nodecircle-drift', type: 'line', source: 'nodecircle',
      filter: ['==', ['get', 'style'], 'drift'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [1, 3] } })
    // The ticker's playhead ring (#224): last, so it is never under a point.
    if (!map.getLayer('rxhighlight')) map.addLayer({ id: 'rxhighlight', type: 'circle', source: 'rxhighlight',
      paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': cssVar('--ch-accent'), 'circle-stroke-width': 2 } })
    // Terrain rides every style load like the sky: setStyle drops the source.
    demReady = false
    applyTerrain()
    for (const cb of readyCbs) cb()
  }
  function afterStyle(cb) { map.once('idle', cb) }

  // setView(m, v): the layer mode and the 3D flag together, applied once
  // (the app's #336). Only a change that crosses the 2D/3D line moves the
  // camera (pitchTransition): a same-side change leaves a tilt the visitor
  // chose alone. easeTo({pitch}) is a no-op while a mesh is set, so the mesh
  // comes off before the tilt back and goes on after the tilt up has
  // settled; the plan itself (is3D) decides either way.
  function setView(m, v) {
    const was3D = is3D
    layerMode = m
    is3D = !!v
    applyLayerVisibility()
    const pitch = pitchTransition(was3D, is3D)
    if (pitch !== null) {
      if (!is3D) applyTerrain()
      map.easeTo({ pitch, duration: 500 })
      if (is3D) map.once('moveend', applyTerrain)
    } else applyTerrain()
  }
  function setExaggeration(x) { terrainExag = Number(x) || DEFAULT_EXAGGERATION; applyTerrain() }

  // A house button in the map's control corner (#595): a MapLibre control
  // group of one, so it stacks under the zoom and compass the library
  // places, and styles with them. The caller owns the state; this only
  // draws the button and reports the click.
  function addButton({ id, label, html, onClick }, position = 'top-left') {
    const el = document.createElement('div')
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group'
    const btn = document.createElement('button')
    btn.type = 'button'; btn.id = id; btn.innerHTML = html
    btn.setAttribute('aria-label', label); btn.setAttribute('aria-pressed', 'false')
    btn.addEventListener('click', onClick)
    el.appendChild(btn)
    map.addControl({ onAdd() { return el }, onRemove() { el.remove() } }, position)
    return btn
  }
  function mountBare() { if (map.isStyleLoaded()) addOverlays(); else setTimeout(mountBare, 100) }
  map.on('load', addOverlays)
  armStyleFallback()

  // MapLibre latches onto a 400x300 fallback when built before #map has laid
  // out (the app's syncSize); the bar's height decides the map's top after
  // load, so the same reconciliation runs on every draw here.
  function syncSize() {
    const c = map.getContainer(), cv = map.getCanvas()
    if (c.clientWidth && c.clientHeight &&
        (Math.abs(cv.clientWidth - c.clientWidth) > 1 || Math.abs(cv.clientHeight - c.clientHeight) > 1)) {
      map.resize()
    }
  }

  function setData(id, fcOrNull) {
    const data = fcOrNull || EMPTY
    pending.set(id, data)
    const src = map.getSource(id)
    if (src) src.setData(data)
  }

  // ---- popups ----
  // One open popup at a time, as on Leaflet: opening another closes it, and
  // the 'open'/'close' events reach map.js so a name-resolution redraw can be
  // held while a popup is under the cursor (#271).
  let popup = null
  const popupCbs = []
  function closePopup() { if (popup) { const p = popup; popup = null; p.remove() } }
  function openPopup(lngLat, html, { closeButton = true, closeOnClick = true, className = '' } = {}) {
    closePopup()
    popup = new maplibregl.Popup({ closeButton, closeOnClick, maxWidth: '280px', className })
      .setLngLat(lngLat).setHTML(html).addTo(map)
    for (const cb of popupCbs) cb(true)
    popup.on('close', () => { if (popup) { popup = null; for (const cb of popupCbs) cb(false) } })
    return popup
  }
  // A hover line for the hex cells: MapLibre has no tooltip, so it is a small
  // closeless popup that follows the pointer and goes on mouseleave.
  let hover = null
  function hoverText(layerId, textOf) {
    map.on('mousemove', layerId, (e) => {
      const f = e.features && e.features[0]; if (!f) return
      const text = textOf(f.properties)
      if (!text) return
      if (!hover) hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'ch-hover', offset: 8 })
      hover.setLngLat(e.lngLat).setText(text)
      if (!hover.isOpen()) hover.addTo(map)
    })
    map.on('mouseleave', layerId, () => { if (hover) hover.remove() })
  }

  function onLayerClick(layerId, cb) {
    map.on('click', layerId, (e) => {
      const f = e.features && e.features[0]; if (!f) return
      cb(f.properties, e.lngLat, e)
    })
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
  }

  // ---- markers, in named groups so a layer can clear its own ----
  const groups = new Map()
  function addMarker(group, el, [lat, lon], { popupHtml = null, anchor = 'center' } = {}) {
    const m = new maplibregl.Marker({ element: el, anchor }).setLngLat([lon, lat]).addTo(map)
    if (popupHtml) el.addEventListener('click', (e) => { e.stopPropagation(); openPopup([lon, lat], popupHtml) })
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(m)
    return m
  }
  function clearMarkers(group) {
    for (const m of groups.get(group) || []) m.remove()
    groups.set(group, [])
  }
  function markerCount(group) { return (groups.get(group) || []).length }
  function markerLatLng(group, i = 0) {
    const m = (groups.get(group) || [])[i]
    if (!m) return null
    const ll = m.getLngLat()
    return { lat: ll.lat, lng: ll.lng }
  }

  // ---- the locate density image ----
  function setHeat(next) {
    heat = next
    if (!overlaysReady) return
    if (!next) {
      if (map.getLayer('locate-heat')) map.removeLayer('locate-heat')
      if (map.getSource('locate-heat')) map.removeSource('locate-heat')
      return
    }
    if (map.getSource('locate-heat')) {
      map.getSource('locate-heat').updateImage({ url: next.url, coordinates: next.coordinates })
    } else {
      map.addSource('locate-heat', { type: 'image', url: next.url, coordinates: next.coordinates })
    }
    if (!map.getLayer('locate-heat')) {
      map.addLayer({ id: 'locate-heat', type: 'raster', source: 'locate-heat',
        paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 } }, map.getLayer('points') ? 'points' : undefined)
    }
  }

  return {
    map,
    setTheme(next) {
      currentTheme = next
      overlaysReady = false
      map.setStyle(STYLES[next] || STYLES.dark)
      afterStyle(addOverlays)
      armStyleFallback()
    },
    onOverlaysReady(cb) { readyCbs.push(cb); if (overlaysReady) cb() },
    isReady() { return overlaysReady },
    setData, setHeat, syncSize,
    openPopup, closePopup, onPopup(cb) { popupCbs.push(cb) }, hoverText, onLayerClick,
    addMarker, clearMarkers, markerCount, markerLatLng,
    // Counts what a source holds, for the tests that used to count Leaflet's
    // SVG paths: canvas circles have no DOM node to count.
    featureCount(id) { const d = pending.get(id); return d ? d.features.length : 0 },
    heatImage() { return heat },
    getBounds() {
      const b = map.getBounds()
      return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }
    },
    getZoom() { return map.getZoom() },
    getCenter() { const c = map.getCenter(); return { lat: c.lat, lng: c.lng } },
    project(lat, lon) { const p = map.project([lon, lat]); return { x: p.x, y: p.y } },
    fitBounds(bounds) { if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 16 }) },
    getBearing() { return map.getBearing() },
    getPitch() { return map.getPitch() },
    setView, setExaggeration, addButton,
    // Test hooks (#595): what a layer is set to, a paint value, and whether
    // the mesh is on. The canvas has no DOM to read, so these are the read.
    layerVisible(id) { return !!map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none' },
    paint(id, prop) { return map.getLayer(id) ? map.getPaintProperty(id, prop) : undefined },
    terrainState() { return { on: is3D, ready: demReady, mesh: !!(map.getTerrain && map.getTerrain()), exaggeration: terrainExag } },
    getContainer() { return map.getContainer() },
    on(ev, cb) { map.on(ev, cb) },
    destroy() { clearInterval(skyTimer); clearTimeout(styleTimer); map.remove() },
  }
}
