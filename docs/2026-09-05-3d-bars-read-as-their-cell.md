# A 3D bar reads as its own cell (#412)

**Date:** 2026-09-05
**Status:** measured and implemented
**Related:** #302 (alpha in the colour on points-3d), #446 (the vertical gradient off, first cut of this issue), #402 (translucent extrusions z-fight), #147 (3D mode)

## What was wrong, measured

The flat hex cell is the tier colour at the tier's opacity over the basemap: `faint` is a 19% tint, `hot` 70%. The 3D bar drew the token colour opaque at one layer opacity, 0.85, for every tier. So a `faint` bar stood as a solid purple on a pale patch, and the mismatch grew the weaker the signal, which is what the field saw (Kasper, 2026-08-22 and 2026-09-05: "worse at weak signal"). The style light on top of that, MapLibre's default intensity 0.5, darkened every face by another 7 to 17%.

Pixels read from the WebGL canvas in the browser, dark theme, a hot and a faint reception, cell against bar:

| | cell | bar before | bar after |
|---|---|---|---|
| hot | 181, 51, 44 | 188, 56, 48 | 178, 57, 51 |
| faint | 39, 30, 58 | 111, 79, 178 | 43, 37, 68 |

Light theme after: hot 217, 92, 90 against 213, 95, 93; faint 198, 190, 212 against 211, 198, 216.

## What changed

1. **The bar is painted the cell's tint, opaque** (`pillarTint`, `app/src/signal.js`): the tier colour pre-mixed over the theme background at the tier's opacity, which is what the flat cell composites to. Opaque rather than alpha in the colour (the #302 route on points-3d): a translucent extrusion compounds its own faces and z-fights the walls it shares with its neighbours (#402); hex cells share every wall.
2. **The style light at 0.15** (`EXTRUSION_LIGHT_INTENSITY`), set on every style load like the sky. Measured: at 0.5 a hot bar was 7% darker than its cell, at 0.15 2%, at 0 exact; buildings still shade at 0.15 (45, 53, 66 against 38, 45, 56 at 0.5 and 50, 60, 74 flat).
3. **The theme is in the hex cache key**: the colours are read from the tokens at build time, so a theme switch on unchanged records rebuilds the cells rather than serving the other theme's from the cache.

## Left out

- `points-3d` keeps #302's alpha in the colour, with age fade: the point bars are not shared-wall geometry, and their fade is worth the translucency. Not measured here.
- A light of 0: exact colours, flat buildings. 0.15 keeps the shapes.
