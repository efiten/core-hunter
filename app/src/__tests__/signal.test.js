import { describe, it, expect } from 'vitest'
import { snrTier, tierColorVar, fillOpacity, rssiTier, effectivePlotOffset, extrusionHeight, withAlpha, rssiToPct, RSSI_WEAK_DBM, RSSI_STRONG_DBM , tintOver, pillarTint, pillarAlpha, BACKLOG_PILLAR_ALPHA, EXTRUSION_LIGHT_INTENSITY } from '../signal.js'

describe('thermal signal tiers (hot = strong)', () => {
  it('maps SNR to tiers', () => {
    expect(snrTier(0)).toBe('hot')
    expect(snrTier(-3)).toBe('warm')
    expect(snrTier(-7)).toBe('mid')
    expect(snrTier(-12)).toBe('cool')
    expect(snrTier(-20)).toBe('cold')
    expect(snrTier(null)).toBe('none')
  })
  it('exposes css var + opacity per tier', () => {
    expect(tierColorVar('hot')).toBe('--ch-sig-hot')
    expect(fillOpacity('hot')).toBeGreaterThan(fillOpacity('cold'))
    expect(fillOpacity('none')).toBeLessThan(fillOpacity('cool'))
  })
  // Opacity is the non-hue cue that carries the tier ramp for a colour-blind
  // reader, so it has to keep falling monotonically as the tiers weaken.
  it('has a strictly decreasing opacity ramp from hot to none', () => {
    const ramp = ['hot', 'warm', 'mid', 'cool', 'cold', 'faint', 'none'].map(fillOpacity)
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeLessThan(ramp[i - 1])
  })
})

describe('rssiTier — fixed dBm bands (hot = strong = close)', () => {
  it('maps RSSI dBm to tiers', () => {
    expect(rssiTier(-70)).toBe('hot')
    expect(rssiTier(-85)).toBe('warm')
    expect(rssiTier(-95)).toBe('mid')
    expect(rssiTier(-105)).toBe('cool')
    expect(rssiTier(-112)).toBe('cold')
    expect(rssiTier(-120)).toBe('faint')
    expect(rssiTier(null)).toBe('none')
  })
  // LoRa decodes well below -110: 26% of production receptions (35% of the
  // zero-hop ones the direction-finding actually relies on) used to collapse
  // into one bucket at the fringe the map exists to describe (#282).
  it('splits the sub -110 fringe at -115 instead of collapsing it', () => {
    expect(rssiTier(-110)).toBe('cool')
    expect(rssiTier(-111)).toBe('cold')
    expect(rssiTier(-115)).toBe('cold')
    expect(rssiTier(-116)).toBe('faint')
    expect(rssiTier(-127)).toBe('faint')
  })
  it('applies calibration offset before banding', () => {
    // -92 + 5 = -87 → warm
    expect(rssiTier(-92, 5)).toBe('warm')
  })
})

describe('extrusionHeight — RSSI tier → 3D hex-bar height (metres)', () => {
  it('is taller for a stronger (hotter) tier', () => {
    expect(extrusionHeight(-70)).toBeGreaterThan(extrusionHeight(-85))
    expect(extrusionHeight(-85)).toBeGreaterThan(extrusionHeight(-95))
    expect(extrusionHeight(-95)).toBeGreaterThan(extrusionHeight(-105))
    expect(extrusionHeight(-105)).toBeGreaterThan(extrusionHeight(-112))
    expect(extrusionHeight(-112)).toBeGreaterThan(extrusionHeight(-120))
  })
  it('gives the faint tier a bar of its own, above no-signal', () => {
    expect(extrusionHeight(-120)).toBeGreaterThan(extrusionHeight(null))
  })
  it('is 0 for a cell with no RSSI reading', () => {
    expect(extrusionHeight(null)).toBe(0)
  })
  it('applies the calibration offset before banding, same as rssiTier', () => {
    // -92 + 5 = -87 → warm, same height as a direct -87 reading
    expect(extrusionHeight(-92, 5)).toBe(extrusionHeight(-87))
  })
})

describe('rssiToPct — HUD thermal-bar marker position', () => {
  it('puts the weak and strong anchors at the ends of the bar', () => {
    expect(rssiToPct(RSSI_WEAK_DBM, 0)).toBe(0)
    expect(rssiToPct(RSSI_STRONG_DBM, 0)).toBe(100)
  })
  it('clamps outside the band', () => {
    expect(rssiToPct(-140, 0)).toBe(0)
    expect(rssiToPct(-20, 0)).toBe(100)
  })
  it('still moves across the sub -115 fringe (#282)', () => {
    expect(rssiToPct(-115, 0)).toBeGreaterThan(rssiToPct(-125, 0))
  })
  it('applies the plot offset before positioning', () => {
    expect(rssiToPct(-105, 10)).toBe(rssiToPct(-95, 0))
  })
  it('parks a missing reading just inside the weak end, not flush against it', () => {
    expect(rssiToPct(null, 0)).toBe(10)
  })
})

describe('effectivePlotOffset — calibration + attenuator added back', () => {
  it('adds the attenuation magnitude back (a −20 dB attenuator → +20)', () => {
    expect(effectivePlotOffset(0, -20)).toBe(20)
    expect(effectivePlotOffset(0, -10)).toBe(10)
    expect(effectivePlotOffset(0, -30)).toBe(30)
  })
  it('stacks on top of the device calibration offset', () => {
    expect(effectivePlotOffset(5, -20)).toBe(25)
    expect(effectivePlotOffset(-3, -10)).toBe(7)
  })
  it('is a no-op at 0 dB and defaults missing args to 0', () => {
    expect(effectivePlotOffset(0, 0)).toBe(0)
    expect(effectivePlotOffset()).toBe(0)
    expect(effectivePlotOffset(8)).toBe(8)
  })
})

// ageFade and its tests went in #648. It measured age against the time window
// rather than against the drive, so the gradient was usually invisible, and it
// held the only per-feature channel a pillar has. The pulse says what is
// arriving now and the ride step says what is from before — see signal.js.

// #647 spends the channel #648 freed. The tiers occupy 0.7 down to 0.15, and
// the backlog steps off that scale entirely rather than sliding down it, which
// mirrors what 2D does: there the backlog drops its fill and keeps its outline.
const TIERS = ['hot', 'warm', 'mid', 'cool', 'cold', 'faint', 'none']
describe('pillarAlpha — which ride a 3D pillar belongs to (#647)', () => {
  it('leaves a reception from this ride on its own tier opacity', () => {
    for (const tier of TIERS) expect(pillarAlpha(tier, false), tier).toBe(fillOpacity(tier))
  })

  it('gives every backlog reception the same value, whatever its tier', () => {
    const all = TIERS.map((tier) => pillarAlpha(tier, true))
    expect(new Set(all).size, 'one flat value, not a factor per tier').toBe(1)
    expect(all[0]).toBe(BACKLOG_PILLAR_ALPHA)
  })

  it('puts the backlog under every tier that actually draws a pillar', () => {
    // The invariant the flat value exists for, and the one a later tweak could
    // quietly break: within a colour, this ride must always be the more present
    // of the two, so nothing from this ride can imitate a backlog pillar.
    // 'none' is left out because extrusionHeight gives it 0 — no pillar is
    // drawn for it at any alpha, so it cannot be confused with anything.
    // 'none' is the no-metric tier, reached by a null rssi and not by a weak
    // one: -130 dBm is 'faint', which does draw. Nothing is exempt except the
    // reception that carries no measurement at all.
    expect(extrusionHeight(null), 'none draws nothing, which is why it is exempt').toBe(0)
    for (const tier of TIERS.filter((t) => t !== 'none')) {
      expect(BACKLOG_PILLAR_ALPHA, tier).toBeLessThan(fillOpacity(tier))
    }
  })

  it('stays above zero, so the backlog is dimmed rather than deleted', () => {
    // The map must never hide a measurement: a backlog reception is still where
    // something was heard, which is the same reason 2D keeps the outline.
    expect(BACKLOG_PILLAR_ALPHA).toBeGreaterThan(0)
  })
})

// #624: with a coverage star selected, a 3D bar outside it steps back by the
// same factor as its flat cell, so the two still agree under a selection.
describe('pillarTint takes a selection dim (#624)', () => {
  it('leaves a bar exactly as it was when nothing dims it', () => {
    expect(pillarTint('hot', '#ff0000', '#000000')).toBe('#b30000')      // 255 x 0.7 over black
    expect(pillarTint('hot', '#ff0000', '#000000', 1)).toBe('#b30000')
  })

  it('pre-mixes the dimmed opacity, so a dimmed bar moves toward the ground', () => {
    // 255 x 0.7 x 0.25 over black is 44.6, which rounds to 0x2d.
    expect(pillarTint('hot', '#ff0000', '#000000', 0.25)).toBe('#2d0000')
  })
})

describe('withAlpha — pillars carry fade in the colour (#302)', () => {
  it('converts a 6-digit hex token to rgba', () => {
    expect(withAlpha('#ff453a', 0.5)).toBe('rgba(255,69,58,0.5)')
  })
  it('expands 3-digit shorthand', () => {
    expect(withAlpha('#f00', 1)).toBe('rgba(255,0,0,1)')
  })
  it('clamps out-of-range alpha rather than emitting an invalid colour', () => {
    expect(withAlpha('#ff453a', 2)).toBe('rgba(255,69,58,1)')
    expect(withAlpha('#ff453a', -1)).toBe('rgba(255,69,58,0)')
  })
  it('rounds long alphas so the feature property stays compact', () => {
    // Float arithmetic on an opacity produces values like 0.5399999999999999,
    // which would otherwise reach the paint property at full length.
    expect(withAlpha('#ff453a', 0.5399999999999999)).toBe('rgba(255,69,58,0.54)')
  })
  it('passes through a colour it cannot parse instead of guessing', () => {
    // A token already in rgb()/rgba() form degrades to "no fade", not to an
    // invalid paint value that would drop the whole layer.
    expect(withAlpha('rgb(1,2,3)', 0.5)).toBe('rgb(1,2,3)')
    expect(withAlpha('', 0.5)).toBe('')
  })
  it('tolerates whitespace around the token, as getPropertyValue returns it', () => {
    expect(withAlpha('  #ff453a  ', 0.25)).toBe('rgba(255,69,58,0.25)')
  })
})

// #412: a flat cell is the tier colour at the tier's opacity over the
// basemap, so a faint cell is a pale tint. The 3D bar drew the token colour
// opaque, at one layer opacity for every tier, so a faint bar stood as a
// solid purple on a pale patch: worse the weaker the signal. The bar now
// draws the tint pre-mixed over the theme background, opaque, so shared walls
// keep depth-testing (no translucent compounding, #402) and the bar reads as
// its cell. Measured in the browser: bar within 2-4% of its cell at every
// tier once the style light sits at EXTRUSION_LIGHT_INTENSITY.
describe('tintOver and pillarTint', () => {
  it('mixes the colour over the background by the alpha, in the channel maths the flat layer gets from the GPU', () => {
    expect(tintOver('#ff453a', '#0b0e14', 0.7)).toBe('#b6352f')
    expect(tintOver('#9b6bff', '#0b0e14', 0.19)).toBe('#262041')
    expect(tintOver('#9b6bff', '#0b0e14', 1)).toBe('#9b6bff')
    expect(tintOver('#9b6bff', '#0b0e14', 0)).toBe('#0b0e14')
  })
  it('gives a bar the same tint its cell has: the tier opacity, over the background', () => {
    expect(pillarTint('faint', '#9b6bff', '#0b0e14')).toBe(tintOver('#9b6bff', '#0b0e14', fillOpacity('faint')))
    expect(pillarTint('hot', '#ff453a', '#0b0e14')).toBe(tintOver('#ff453a', '#0b0e14', fillOpacity('hot')))
  })
  it('keeps the style light low enough that shading cannot pass for a lower tier', () => {
    // Measured 2026-09-05 (dark theme, hot bar against its cell): 7% darker
    // at MapLibre's default 0.5, 2% at 0.15, and buildings still shade.
    expect(EXTRUSION_LIGHT_INTENSITY).toBeLessThanOrEqual(0.2)
    expect(EXTRUSION_LIGHT_INTENSITY).toBeGreaterThan(0)
  })
})
