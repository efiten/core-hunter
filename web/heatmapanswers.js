// The size of the cells in a single-size answer, read off the first cell's id
// ("res:q:r"); an empty answer is taken as the size asked.
function resOfCells(fc, asked) {
  const cell = fc.features && fc.features[0] && fc.features[0].properties && fc.features[0].properties.cell
  const res = cell ? parseInt(String(cell).split(':')[0], 10) : NaN
  return Number.isFinite(res) ? res : asked
}

// heatmapAnswers: the cell sizes in an /api/heatmap answer (#742). Asked for
// two sizes (z=a,b) the server answers { layers: [...] }, one collection per
// size from one point query, each tagged with its res; a size the caller's
// ceiling folds into another comes once. A single z answers a bare collection.
// `capped` says the server answered coarser than the finest size asked: below
// member it caps the zoom, and above 18 it has nothing finer.
export function heatmapAnswers(body, asked) {
  const top = Math.max(...asked)
  const answers = Array.isArray(body && body.layers)
    ? body.layers.map((fc) => ({ res: fc.res, fc }))
    : [{ res: resOfCells(body, top), fc: body }]
  return { answers, capped: Math.max(...answers.map((a) => a.res)) < top }
}
