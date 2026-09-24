// MapLibre ships in the build (#617). It used to come from unpkg as a blocking
// script, so a launch without that host stopped before first paint. huntmap.js
// reads the `maplibregl` global, which this keeps. The version is pinned in
// package.json, as the URL pinned it before.
import maplibregl from 'maplibre-gl'

window.maplibregl = maplibregl
