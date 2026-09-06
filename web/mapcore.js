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
import { skyForHour, currentHour } from './sky.js'

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
}
const EMPTY = { type: 'FeatureCollection', features: [] }
const bareStyle = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] })
// The sources the data layers read, all GeoJSON, all set through setData.
const GEO_SOURCES = ['hex', 'reach', 'points', 'observer-advert', 'observer-rxlog', 'locate-in', 'locate-out', 'rxhighlight', 'nodedrift', 'nodecircle']

export function createWebMap(containerId, { center, zoom, theme = 'dark' } = {}) {
  const map = new maplibregl.Map({
    container: containerId, style: STYLES[theme] || STYLES.dark,
    center: [center[1], center[0]], zoom,
    attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
  map.addControl(new maplibregl.AttributionControl({ compact: true }))

  let currentTheme = theme
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

  function addOverlays() {
    clearTimeout(styleTimer); overlaysReady = true
    applySky()
    for (const id of GEO_SOURCES) {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: pending.get(id) || EMPTY })
    }
    if (heat && !map.getSource('locate-heat')) map.addSource('locate-heat', { type: 'image', url: heat.url, coordinates: heat.coordinates })
    // Bottom to top: the hex heat, the locate cloud over it, then the dots,
    // then the lines and rings that must never sink under a hot cell.
    if (!map.getLayer('hex')) map.addLayer({ id: 'hex', type: 'fill', source: 'hex',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } })
    if (!map.getLayer('hex-outline')) map.addLayer({ id: 'hex-outline', type: 'line', source: 'hex',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.9 } })
    if (heat && !map.getLayer('locate-heat')) map.addLayer({ id: 'locate-heat', type: 'raster', source: 'locate-heat',
      paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 } })
    // A node's reach (#549): one line per direct hearing, under the dots so
    // the hearings stay readable at the hub.
    if (!map.getLayer('reach')) map.addLayer({ id: 'reach', type: 'line', source: 'reach',
      paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': ['get', 'op'] } })
    if (!map.getLayer('points')) map.addLayer({ id: 'points', type: 'circle', source: 'points',
      paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'op'],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1 } })
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
    for (const cb of readyCbs) cb()
  }
  function afterStyle(cb) { map.once('idle', cb) }
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
    setView(lat, lon, z) { map.jumpTo({ center: [lon, lat], ...(z != null ? { zoom: z } : {}) }) },
    getContainer() { return map.getContainer() },
    on(ev, cb) { map.on(ev, cb) },
    destroy() { clearInterval(skyTimer); clearTimeout(styleTimer); map.remove() },
  }
}
