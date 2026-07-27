# Spike — native wrapper for true screen-off/background capture (#200)

2026-07-18. Follow-up from the #144 research, which concluded true
screen-off/background capture is **not achievable on the web platform**: no
background Web Bluetooth, no background geolocation, service workers cannot
use BLE, and the notification trick does not keep page JS alive. The only
real path is a native wrapper. This is a feasibility spike only — nothing in
`app/` changes as a result of it.

## Key architectural fact

core-hunter **connects** to the companion radio and subscribes to the `0x88`
RX-log characteristic (`transport.js`) — it does **not** scan for adverts. On
iOS this distinction is decisive for what's possible in the background.

## Android — feasible

A foreground service holds the GATT connection + fused location with the
screen off. `@capacitor-community/bluetooth-le` provides
`startForegroundService` (Android-only, built exactly for this) — see
[capacitor-community/bluetooth-le#643](https://github.com/capacitor-community/bluetooth-le/issues/643).
Background location via a background-location plugin, behind a persistent
notification.

## iOS — feasible for our connect+notify model (not for scanning)

With `bluetooth-central` in `UIBackgroundModes`, Core Bluetooth callbacks fire
in the background / with the screen locked — including notifications from a
subscribed characteristic — and can even relaunch the app
([Apple: Core Bluetooth Background Processing](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html)).

The "no packets when locked" reports are about advert **scanning** (throttled,
`allowDuplicates` ignored —
[Apple forum](https://developer.apple.com/forums/thread/652592)), not a held
connection, so our connect+notify path is fine. Background location via
Always authorization keeps the app alive and GPS flowing; opt into state
preservation/restoration for relaunch.

## Wrapper options

- **Capacitor (recommended).** Wraps the existing PWA in a native WebView.
  The app already has a clean seam: `transport.js` (BLE port) and `gps.js`
  (geolocation) are the only two modules that must become native — swap them
  for adapters behind the same interface
  (`@capacitor-community/bluetooth-le` + a background-location plugin).
  Everything downstream (`capture.js`'s `buildRecord`, `queue.js`,
  `publisher.js`, `huntmap.js`, MQTT-over-WSS) is unchanged, keeping the
  untestable surface thin per AGENTS.md §5.1.
- **Cordova** — older/less maintained; skip.
- **Fully native capture core + web UI** — most control, most effort;
  overkill given the Capacitor seam above already exists.

## Effort

Medium. A Capacitor project around `app/`, two adapters behind the existing
`transport.js`/`gps.js` interfaces, native config (Info.plist background
modes; Android foreground service + permissions), and device testing. Rough
estimate: 1–2 weeks for a working Android FG-service build; iOS similar plus
device-test overhead. No change to the web capture pipeline.

## Recommendation

**Pursue — Android first** (clearest path, biggest field value); iOS second
(feasible via connect-notify + background location). This is a separate
track from the PWA; the PWA stays the default experience.

## Follow-up issues, if pursued

1. Capacitor shell around `app/` + build pipeline (Android first).
2. Native BLE transport adapter behind the `transport.js` interface + Android
   foreground service.
3. Background location adapter behind the `gps.js` interface.
4. iOS: `bluetooth-central` + background location + state restoration;
   device test.
5. Capture continuity + battery/UX (persistent notification, stop control).
