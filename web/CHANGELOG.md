# Changelog

## [0.6.0](https://github.com/efiten/core-hunter/compare/web-v0.5.0...web-v0.6.0) (2026-07-03)


### Features

* web filter parity with the app (packet-type + direct-only via hops) ([#170](https://github.com/efiten/core-hunter/issues/170)) ([3ce0640](https://github.com/efiten/core-hunter/commit/3ce0640def61afe4fb0331c2ab2e5dfb6a3ffaec))


### Bug Fixes

* **web:** CS-layer toggle clears reliably; add Clear button + sender-name hover ([#171](https://github.com/efiten/core-hunter/issues/171)) ([4594d75](https://github.com/efiten/core-hunter/commit/4594d75062375657c7cc6187b2f0610e55baf790))

## [0.5.0](https://github.com/efiten/core-hunter/compare/web-v0.4.1...web-v0.5.0) (2026-07-02)


### Features

* lift the 5000-point cap — paged points fetch (map 25k, Locate all) ([#160](https://github.com/efiten/core-hunter/issues/160)) ([0a1413b](https://github.com/efiten/core-hunter/commit/0a1413b5a027de4417ca31a576b0c1e01f3efa7a))
* nameresolver — standalone SF7 name resolver + web multi-resolver support ([#156](https://github.com/efiten/core-hunter/issues/156)) ([a574d8a](https://github.com/efiten/core-hunter/commit/a574d8af0b0f250bee52cd7a24b751280eaf8bd5))
* show SF7/SF8 node counts in the website top bar ([#158](https://github.com/efiten/core-hunter/issues/158)) ([819f4b3](https://github.com/efiten/core-hunter/commit/819f4b3093b5e0f6d372745778d6c54a6821bcbe))
* **web:** complete the Locate legend toggle (style + e2e test) ([#161](https://github.com/efiten/core-hunter/issues/161)) ([1c98734](https://github.com/efiten/core-hunter/commit/1c9873436266d92e2aec94cac1ed72e18bb5e8a1))
* **web:** reflect all settings in the URL and persist them ([#135](https://github.com/efiten/core-hunter/issues/135)) ([2b75f6f](https://github.com/efiten/core-hunter/commit/2b75f6fd466addd1b98aecbc0f8d7dc9f19e99ea)), closes [#134](https://github.com/efiten/core-hunter/issues/134)


### Bug Fixes

* **web:** map starts in hex mode by default ([#152](https://github.com/efiten/core-hunter/issues/152)) ([6794d77](https://github.com/efiten/core-hunter/commit/6794d77939eb32978c239dee11128028130cddb6))

## [0.4.1](https://github.com/efiten/core-hunter/compare/web-v0.4.0...web-v0.4.1) (2026-07-01)


### Documentation

* dedupe release changelogs (drop merge-commit duplicates) ([#70](https://github.com/efiten/core-hunter/issues/70)) ([10d0528](https://github.com/efiten/core-hunter/commit/10d0528017a72cdc4db530dafaf157a37bb7487f))

## [0.4.0](https://github.com/efiten/core-hunter/compare/web-v0.3.0...web-v0.4.0) (2026-07-01)


### Features

* CoreScope mobile-observer points as two optional map layers (adverts/relays) ([aa411fd](https://github.com/efiten/core-hunter/commit/aa411fdab14d4124d2474f93fa59874bc76f7836)), closes [#60](https://github.com/efiten/core-hunter/issues/60)
* identify every zero-hop node (advert + discover) by ID + role, resolve name via API ([3728f26](https://github.com/efiten/core-hunter/commit/3728f262d84fbeab984d130e0979422326532db9)), closes [#41](https://github.com/efiten/core-hunter/issues/41)
* Locate merges CoreScope sightings + focus-mode hides other points ([ad36014](https://github.com/efiten/core-hunter/commit/ad360145d820d6fea0f98c1b53bb18143d871c9e)), closes [#62](https://github.com/efiten/core-hunter/issues/62)
* **web:** live Locate layer — centroid, heatmap, outliers, polling ([bed8936](https://github.com/efiten/core-hunter/commit/bed89367e9410853ec0c37adc329a087e9ec4675))
* **web:** Locate — show strongest-reception marker alongside centroid ([03139db](https://github.com/efiten/core-hunter/commit/03139db5624b0a7f72a2177abe762135bc088495))
* **web:** Locate button + info-card scaffolding ([7f0cffa](https://github.com/efiten/core-hunter/commit/7f0cffabfb5fd57cf42c20aa745ce70f24b775e5))
* **web:** locate.js convergence + encirclement stats ([02f2ed9](https://github.com/efiten/core-hunter/commit/02f2ed9e05d798d638baacf6377407f801d2ecbe))
* **web:** locate.js core math + web vitest harness ([c80df52](https://github.com/efiten/core-hunter/commit/c80df52fcd4f64711e92d86217757cb6a3318027))
* **web:** locate.js geographic outlier rejection ([2718b19](https://github.com/efiten/core-hunter/commit/2718b19789fc45a974691ef40326ba08075bc59a))
* **web:** locate.js RSSI-weighted kernel-density heatmap ([e9b7a79](https://github.com/efiten/core-hunter/commit/e9b7a7991a658ad74068181b0657ca8a6465308a))
* **web:** locate() orchestrator ([0f5fb3f](https://github.com/efiten/core-hunter/commit/0f5fb3fedd6fdc810ceab7ab72f7474e7b2db86c))
* **web:** point popup shows sender ID + a 'Locate this sender' button ([62d3de7](https://github.com/efiten/core-hunter/commit/62d3de76e23c25086108caa1eb75c9e31698324f)), closes [#58](https://github.com/efiten/core-hunter/issues/58)


### Bug Fixes

* **web:** address final-review findings on Locate ([375deeb](https://github.com/efiten/core-hunter/commit/375deebbebe4889f3b728c07431065ec4e3a1464))
* **web:** Locate — dedupe stationary clusters (10m) + 20km outlier floor ([76005b1](https://github.com/efiten/core-hunter/commit/76005b1b6004be309ebf3fd327c2d1fe873230d6)), closes [#33](https://github.com/efiten/core-hunter/issues/33)
* **web:** Locate — linear-power RSSI weighting with -55 dBm cap ([d0e7382](https://github.com/efiten/core-hunter/commit/d0e7382bd2f44eedbe8c7dc9b18ff1b67d1ee818))
* **web:** pad density grid by 3-sigma so the heatmap border is transparent ([f92d614](https://github.com/efiten/core-hunter/commit/f92d61424487d68f2e85936dc2985cedd89bd437)), closes [#39](https://github.com/efiten/core-hunter/issues/39)
* **web:** remove heatmap rectangle artifact + e2e for filter bar & toggles ([6f2fe5e](https://github.com/efiten/core-hunter/commit/6f2fe5eae83eba95bb062cae94d8607f50b6fabc)), closes [#37](https://github.com/efiten/core-hunter/issues/37)


### Tests

* **web:** Playwright E2E harness + Locate suite; run web in CI ([205cd47](https://github.com/efiten/core-hunter/commit/205cd478f74de2bbf25f16cf2367cec8b373618b)), closes [#35](https://github.com/efiten/core-hunter/issues/35)
* **web:** scope vitest to *.test.js so it ignores the Playwright e2e specs ([e7d0617](https://github.com/efiten/core-hunter/commit/e7d0617c897a7d95d84c3d59464137f91d7500e8))


### Miscellaneous Chores

* **web:** gitignore dev-only vitest harness artifacts ([d866ec2](https://github.com/efiten/core-hunter/commit/d866ec2b3435b711fe48ad92c144cccdaa14aa70))

## [0.3.0](https://github.com/efiten/core-hunter/compare/web-v0.2.0...web-v0.3.0) (2026-06-30)


### Features

* **app,web:** resolve node names from CoreScope for full-pubkey senders ([197fc5a](https://github.com/efiten/core-hunter/commit/197fc5a399f6655c240951cea086bf56d891fcd1))

## [0.2.0](https://github.com/efiten/core-hunter/compare/web-v0.1.0...web-v0.2.0) (2026-06-30)


### Features

* analysis website — multi-hunter map at map.on8ar.eu ([#19](https://github.com/efiten/core-hunter/issues/19)) ([42465fb](https://github.com/efiten/core-hunter/commit/42465fb4226677439b5a86d420cb990847b6334d))
* **server,web:** expose server version via /api/version and show it on the site ([c4cde9d](https://github.com/efiten/core-hunter/commit/c4cde9d3e55dc9f193eb0c0df62497e5b34b187c))
* **web:** add light/dark theme toggle ([58f5bfe](https://github.com/efiten/core-hunter/commit/58f5bfe69881797921c8c39d4956c950a7cd9d3b))
* **web:** version the analysis site as its own release-please component ([be038ed](https://github.com/efiten/core-hunter/commit/be038ed374c90be311736ca78f95353427b7d008))


### Bug Fixes

* **web:** default timeframe to today and open native picker on click ([1de7bc3](https://github.com/efiten/core-hunter/commit/1de7bc33af66a1f2551652cf30b87932fd91636b))
