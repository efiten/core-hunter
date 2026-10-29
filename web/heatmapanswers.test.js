import { describe, it, expect } from 'vitest'
import { heatmapAnswers } from './heatmapanswers.js'

// /api/heatmap?z=a,b answers both cell sizes from one point query (#742).
describe('heatmapAnswers', () => {
  const fc = (res, n = 1) => ({
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => ({ properties: { cell: `${res}:${i}:0` } })),
  })
  it('reads one answer per size off the layers', () => {
    const a = fc(13), b = fc(14)
    const out = heatmapAnswers({ layers: [{ res: 13, ...a }, { res: 14, ...b }] }, [13, 14])
    expect(out.answers.map((x) => x.res)).toEqual([13, 14])
    expect(out.answers[1].fc.features).toEqual(b.features)
    expect(out.capped).toBe(false)
  })
  it('is capped when the server folded both sizes into a coarser one', () => {
    const out = heatmapAnswers({ layers: [{ res: 12, ...fc(12) }] }, [13, 14])
    expect(out.answers.map((x) => x.res)).toEqual([12])
    expect(out.capped).toBe(true)
  })
  it('takes an empty layer at the size the server tagged it with', () => {
    const out = heatmapAnswers({ layers: [{ res: 12, type: 'FeatureCollection', features: [] }] }, [13, 14])
    expect(out.answers[0].res).toBe(12)
    expect(out.capped).toBe(true)
  })
  it('is not capped at the top of the range, where both asks are one size', () => {
    const out = heatmapAnswers(fc(18), [18])
    expect(out.answers.map((x) => x.res)).toEqual([18])
    expect(out.capped).toBe(false)
  })
  it('reads a single-size answer by its cells, and an empty one as the size asked', () => {
    expect(heatmapAnswers(fc(12), [13]).answers[0].res).toBe(12)
    expect(heatmapAnswers(fc(12), [13]).capped).toBe(true)
    expect(heatmapAnswers({ features: [] }, [13]).answers[0].res).toBe(13)
  })
})
