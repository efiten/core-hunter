# Changelog

## [1.7.0](https://github.com/efiten/core-hunter/compare/server-v1.6.0...server-v1.7.0) (2026-08-26)


### Features

* **web,server:** tell a hunter when their member verification comes through ([#531](https://github.com/efiten/core-hunter/issues/531)) ([54981ca](https://github.com/efiten/core-hunter/commit/54981ca8c40788c8f63c27324308e93f23bd4a1d))

## [1.6.0](https://github.com/efiten/core-hunter/compare/server-v1.5.1...server-v1.6.0) (2026-08-26)


### Features

* **app,web,server:** filter receptions by sender-id class ([#528](https://github.com/efiten/core-hunter/issues/528)) ([f10b1ac](https://github.com/efiten/core-hunter/commit/f10b1ace28d7dc55cc80dfc051b2ff58e983aca7))

## [1.5.1](https://github.com/efiten/core-hunter/compare/server-v1.5.0...server-v1.5.1) (2026-08-26)


### Bug Fixes

* **web,server:** say how far back the map reaches instead of "capped" ([#488](https://github.com/efiten/core-hunter/issues/488)) ([5a26e51](https://github.com/efiten/core-hunter/commit/5a26e51ce63675c6e9d703223806df6821850dad)), closes [#440](https://github.com/efiten/core-hunter/issues/440)

## [1.5.0](https://github.com/efiten/core-hunter/compare/server-v1.4.0...server-v1.5.0) (2026-08-25)


### Features

* **server,web:** give a flood with no sender something to filter on ([#497](https://github.com/efiten/core-hunter/issues/497)) ([9362217](https://github.com/efiten/core-hunter/commit/93622172c842693b69db7496c082c40b00e0295a))


### Bug Fixes

* **server,app:** stop one reception blocking every reception behind it ([#505](https://github.com/efiten/core-hunter/issues/505)) ([c49b87a](https://github.com/efiten/core-hunter/commit/c49b87accbfd047aaa1affc6dbdbbea0ab3419d2)), closes [#454](https://github.com/efiten/core-hunter/issues/454)

## [1.4.0](https://github.com/efiten/core-hunter/compare/server-v1.3.0...server-v1.4.0) (2026-08-24)


### Features

* **server,web:** show a visitor everything that has been mapped ([#466](https://github.com/efiten/core-hunter/issues/466)) ([4dc885d](https://github.com/efiten/core-hunter/commit/4dc885d178e7e52965b96be5e59b8ca9bd05fb0f))

## [1.3.0](https://github.com/efiten/core-hunter/compare/server-v1.2.0...server-v1.3.0) (2026-08-19)


### Features

* **app,server:** draw SF8 nodes on the position layer too ([#430](https://github.com/efiten/core-hunter/issues/430)) ([863c3ac](https://github.com/efiten/core-hunter/commit/863c3ac7f82a2e0ebe503e8ad9f005b8cdcf7b2e)), closes [#418](https://github.com/efiten/core-hunter/issues/418)

## [1.2.0](https://github.com/efiten/core-hunter/compare/server-v1.1.1...server-v1.2.0) (2026-08-19)


### Features

* **server,web:** draw node positions from the registry, not from what you heard ([#398](https://github.com/efiten/core-hunter/issues/398)) ([a4ac33b](https://github.com/efiten/core-hunter/commit/a4ac33b60e5062ca6697deb1cf514de7db52c923)), closes [#377](https://github.com/efiten/core-hunter/issues/377)

## [1.1.1](https://github.com/efiten/core-hunter/compare/server-v1.1.0...server-v1.1.1) (2026-08-15)


### Bug Fixes

* **server:** store an unknown gps accuracy as NULL and reject a positionless payload ([#349](https://github.com/efiten/core-hunter/issues/349)) ([3232b90](https://github.com/efiten/core-hunter/commit/3232b90725380626b955f49b025f9086dacfde5c))

## [1.1.0](https://github.com/efiten/core-hunter/compare/server-v1.0.1...server-v1.1.0) (2026-07-27)


### Features

* **web,server:** browsable multi-select target-list picker ([#223](https://github.com/efiten/core-hunter/issues/223)) ([#288](https://github.com/efiten/core-hunter/issues/288)) ([184712b](https://github.com/efiten/core-hunter/commit/184712b101aa84a3aaf0b5adb2898c56f1daacef))

## [1.0.1](https://github.com/efiten/core-hunter/compare/server-v1.0.0...server-v1.0.1) (2026-07-04)


### Build System

* **server:** build image with golang:1.26-alpine (go.mod requires go 1.25) ([e3d081b](https://github.com/efiten/core-hunter/commit/e3d081b301802f3f63f215262b2ccfff201569e4))

## [1.0.0](https://github.com/efiten/core-hunter/compare/server-v0.6.0...server-v1.0.0) (2026-07-04)


### Features

* **server:** user management, roles, and guest data degradation (v1.0) ([a3a9c8a](https://github.com/efiten/core-hunter/commit/a3a9c8a05d9f09e99d23655b213dd91f0459670e))

## [0.6.0](https://github.com/efiten/core-hunter/compare/server-v0.5.0...server-v0.6.0) (2026-07-03)


### Features

* web filter parity with the app (packet-type + direct-only via hops) ([#170](https://github.com/efiten/core-hunter/issues/170)) ([3ce0640](https://github.com/efiten/core-hunter/commit/3ce0640def61afe4fb0331c2ab2e5dfb6a3ffaec))

## [0.5.0](https://github.com/efiten/core-hunter/compare/server-v0.4.1...server-v0.5.0) (2026-07-02)


### Features

* lift the 5000-point cap — paged points fetch (map 25k, Locate all) ([#160](https://github.com/efiten/core-hunter/issues/160)) ([0a1413b](https://github.com/efiten/core-hunter/commit/0a1413b5a027de4417ca31a576b0c1e01f3efa7a))

## [0.4.1](https://github.com/efiten/core-hunter/compare/server-v0.4.0...server-v0.4.1) (2026-07-01)


### Documentation

* dedupe release changelogs (drop merge-commit duplicates) ([#70](https://github.com/efiten/core-hunter/issues/70)) ([10d0528](https://github.com/efiten/core-hunter/commit/10d0528017a72cdc4db530dafaf157a37bb7487f))

## [0.4.0](https://github.com/efiten/core-hunter/compare/server-v0.3.0...server-v0.4.0) (2026-07-01)


### Features

* CoreScope mobile-observer points as two optional map layers (adverts/relays) ([aa411fd](https://github.com/efiten/core-hunter/commit/aa411fdab14d4124d2474f93fa59874bc76f7836)), closes [#60](https://github.com/efiten/core-hunter/issues/60)
* identify every zero-hop node (advert + discover) by ID + role, resolve name via API ([3728f26](https://github.com/efiten/core-hunter/commit/3728f262d84fbeab984d130e0979422326532db9)), closes [#41](https://github.com/efiten/core-hunter/issues/41)
* Locate merges CoreScope sightings + focus-mode hides other points ([ad36014](https://github.com/efiten/core-hunter/commit/ad360145d820d6fea0f98c1b53bb18143d871c9e)), closes [#62](https://github.com/efiten/core-hunter/issues/62)

## [0.3.0](https://github.com/efiten/core-hunter/compare/server-v0.2.0...server-v0.3.0) (2026-06-30)


### Features

* **server,web:** expose server version via /api/version and show it on the site ([c4cde9d](https://github.com/efiten/core-hunter/commit/c4cde9d3e55dc9f193eb0c0df62497e5b34b187c))


### Bug Fixes

* **server:** emit hex coverage coordinates in GeoJSON [lon,lat] order ([e55514b](https://github.com/efiten/core-hunter/commit/e55514b29e73178aba57db2a9702a636bfe27125))

## [0.2.0](https://github.com/efiten/core-hunter/compare/server-v0.1.0...server-v0.2.0) (2026-06-30)


### Features

* analysis website — multi-hunter map at map.on8ar.eu ([#19](https://github.com/efiten/core-hunter/issues/19)) ([42465fb](https://github.com/efiten/core-hunter/commit/42465fb4226677439b5a86d420cb990847b6334d))
