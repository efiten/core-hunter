// Theme preference (#563). The app shipped with a single "Light theme"
// checkbox: two states where there are three, and no way to say "follow the
// device", which is the state most people are already in and the one a fresh
// install should start in. It also stored nothing, so a chosen light theme
// lasted until the next reload and index.html's hardcoded dark won again.
//
// 'system' first: it is the default, and the order is also the cycle order.
export const THEME_PREFS = ['system', 'dark', 'light']

// resolveTheme turns the stored preference plus the device's own setting into
// the theme to paint. `prefersDark` is
// matchMedia('(prefers-color-scheme: dark)').matches, which is `undefined`
// wherever matchMedia is absent and before a query resolves. Anything that is
// not one of the two explicit choices means no choice has been made, which is
// 'system'. That covers a missing key, an older build's value and a hand edit,
// without a separate validation step that could disagree with this one.
//
// Only an explicit `false` reads as a light device: an unknown device
// preference resolves to dark, because dark is what index.html paints before
// any of this runs, so the boot path never has to repaint.
export function resolveTheme(pref, prefersDark) {
  if (pref === 'dark' || pref === 'light') return pref
  return prefersDark === false ? 'light' : 'dark'
}

// nextThemePref advances the cycle, for any surface that prefers one control
// that swaps state over three side by side. Total by construction: an
// unrecognised value has index -1 and lands on the first preference rather
// than sticking.
export function nextThemePref(pref) {
  const i = THEME_PREFS.indexOf(pref)
  return THEME_PREFS[(i + 1) % THEME_PREFS.length]
}
