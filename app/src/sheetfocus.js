// closeSheet hides a bottom sheet, and when the focus was inside it hands
// the focus back to the sheet's toggle (#714), as web/multiselect.js does:
// not left on a hidden field, with the caret and on a phone the keyboard,
// and not dropped on the body, where a keyboard user loses their place.
// Every path that hides a sheet goes through here: its close button, its
// toggle, another sheet opening, a tap outside.
export function closeSheet(sheet, toggle, doc = document) {
  if (sheet.contains(doc.activeElement)) toggle.focus()
  sheet.hidden = true
}
