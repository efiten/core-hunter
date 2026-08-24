# Changelog

## [1.10.0](https://github.com/efiten/core-hunter/compare/web-v1.9.2...web-v1.10.0) (2026-08-24)


### Features

* **server,web:** show a visitor everything that has been mapped ([#466](https://github.com/efiten/core-hunter/issues/466)) ([4dc885d](https://github.com/efiten/core-hunter/commit/4dc885d178e7e52965b96be5e59b8ca9bd05fb0f))
* **web:** give the map a settings sheet, so the bar can stop being the junk drawer ([#432](https://github.com/efiten/core-hunter/issues/432)) ([2c5f9d5](https://github.com/efiten/core-hunter/commit/2c5f9d5d2f9bfa523f4362c9f45a53325696d8bc))
* **web:** let the receptions ticker be placed and put away ([#473](https://github.com/efiten/core-hunter/issues/473)) ([6f744a3](https://github.com/efiten/core-hunter/commit/6f744a3dc17d24efda420bb196f28cd61fc8c23f))

## [1.9.2](https://github.com/efiten/core-hunter/compare/web-v1.9.1...web-v1.9.2) (2026-08-24)


### Performance Improvements

* **app:** stop rebuilding a render tick that cannot have changed ([#485](https://github.com/efiten/core-hunter/issues/485)) ([18aa6ca](https://github.com/efiten/core-hunter/commit/18aa6caaf045fff7ecfbfd61ae266070d1c6797d)), closes [#462](https://github.com/efiten/core-hunter/issues/462)

## [1.9.1](https://github.com/efiten/core-hunter/compare/web-v1.9.0...web-v1.9.1) (2026-08-23)


### Documentation

* **app,web:** write the release notes for what shipped since the backfill ([#460](https://github.com/efiten/core-hunter/issues/460)) ([ca1e31a](https://github.com/efiten/core-hunter/commit/ca1e31ae31ff1b38309f6368e5da01e68018207e))

## [1.9.0](https://github.com/efiten/core-hunter/compare/web-v1.8.2...web-v1.9.0) (2026-08-23)


### Features

* **app,web:** write release notes for readers, not from the commit log ([#435](https://github.com/efiten/core-hunter/issues/435)) ([8b70eaa](https://github.com/efiten/core-hunter/commit/8b70eaa4653d1ca5ffb15e8a874b2e1743981ae0))


### Bug Fixes

* **web:** stop node-position labels printing over each other ([#439](https://github.com/efiten/core-hunter/issues/439)) ([a31e34e](https://github.com/efiten/core-hunter/commit/a31e34eda489955d48bcdf6a5e3e52f3e2e3b814))

## [1.8.2](https://github.com/efiten/core-hunter/compare/web-v1.8.1...web-v1.8.2) (2026-08-22)


### Bug Fixes

* **web:** let Leaflet's own controls follow the theme ([#437](https://github.com/efiten/core-hunter/issues/437)) ([86c3ed1](https://github.com/efiten/core-hunter/commit/86c3ed17eebda1323b992a306970d40f30a26f77))
* **web:** let the position disclaimer go on a phone, and stay on a desktop ([#438](https://github.com/efiten/core-hunter/issues/438)) ([8cbd8d6](https://github.com/efiten/core-hunter/commit/8cbd8d6f6f8f8cd79c80ffe68d5c43dc7b4a1c4d))

## [1.8.1](https://github.com/efiten/core-hunter/compare/web-v1.8.0...web-v1.8.1) (2026-08-21)


### Bug Fixes

* **web:** say which way the node-position layer came up empty ([#445](https://github.com/efiten/core-hunter/issues/445)) ([afd9c13](https://github.com/efiten/core-hunter/commit/afd9c13570648281b7c2a8aa5ec18544e6ac161b)), closes [#376](https://github.com/efiten/core-hunter/issues/376)
* **web:** stop the onboarding tour covering the controls it is explaining ([#436](https://github.com/efiten/core-hunter/issues/436)) ([d9500d1](https://github.com/efiten/core-hunter/commit/d9500d11fd4bb90340869163b599f14162cc3608)), closes [#428](https://github.com/efiten/core-hunter/issues/428)


### Tests

* **app,web:** pin densityGrid's kernel, which nothing was holding ([#442](https://github.com/efiten/core-hunter/issues/442)) ([b1807dd](https://github.com/efiten/core-hunter/commit/b1807dde1ba4b70aa9997a5e64c8f77d74a95442)), closes [#370](https://github.com/efiten/core-hunter/issues/370)

## [1.8.0](https://github.com/efiten/core-hunter/compare/web-v1.7.0...web-v1.8.0) (2026-08-19)


### Features

* **app,web:** give the website an onboarding tour, and say what a hunter is ([#379](https://github.com/efiten/core-hunter/issues/379)) ([ea7bb21](https://github.com/efiten/core-hunter/commit/ea7bb21440613c15ab34728cde7dc71db71362a6)), closes [#316](https://github.com/efiten/core-hunter/issues/316) [#371](https://github.com/efiten/core-hunter/issues/371)
* **server,web:** draw node positions from the registry, not from what you heard ([#398](https://github.com/efiten/core-hunter/issues/398)) ([a4ac33b](https://github.com/efiten/core-hunter/commit/a4ac33b60e5062ca6697deb1cf514de7db52c923)), closes [#377](https://github.com/efiten/core-hunter/issues/377)


### Bug Fixes

* **web:** put the bar's popovers back above the receptions ticker ([#417](https://github.com/efiten/core-hunter/issues/417)) ([c4e13c7](https://github.com/efiten/core-hunter/commit/c4e13c79e6749ef872523345ba263c4096c9433d))

## [1.7.0](https://github.com/efiten/core-hunter/compare/web-v1.6.0...web-v1.7.0) (2026-08-19)


### Features

* **app,web:** make the receptions ticker readable at a glance ([#404](https://github.com/efiten/core-hunter/issues/404)) ([c48a974](https://github.com/efiten/core-hunter/commit/c48a9748c5aee14b87e13e4f0374609e45546070)), closes [#322](https://github.com/efiten/core-hunter/issues/322)

## [1.6.0](https://github.com/efiten/core-hunter/compare/web-v1.5.0...web-v1.6.0) (2026-08-18)


### Features

* **app,web:** show what changed in a release behind a version badge ([#363](https://github.com/efiten/core-hunter/issues/363)) ([3a3dcf1](https://github.com/efiten/core-hunter/commit/3a3dcf128502790e5e1ecda0b3a3a0808a143752)), closes [#284](https://github.com/efiten/core-hunter/issues/284)


### Bug Fixes

* **web:** hide Locate until the role is known ([#393](https://github.com/efiten/core-hunter/issues/393)) ([412daa4](https://github.com/efiten/core-hunter/commit/412daa4ef2096bfc098ff83208782379969dfaa2)), closes [#270](https://github.com/efiten/core-hunter/issues/270)
* **web:** keep bar popovers on screen whatever the toggle's position ([#385](https://github.com/efiten/core-hunter/issues/385)) ([29ce125](https://github.com/efiten/core-hunter/commit/29ce1258113e0cbc94d6688433885e64eccb446a)), closes [#372](https://github.com/efiten/core-hunter/issues/372)
* **web:** keep node positions out of the Locate focus view ([#391](https://github.com/efiten/core-hunter/issues/391)) ([7eb0f6c](https://github.com/efiten/core-hunter/commit/7eb0f6c16055b01a254474bdb774df8bf582958e)), closes [#390](https://github.com/efiten/core-hunter/issues/390)
* **web:** keep the receptions ticker off the bar's last row ([#388](https://github.com/efiten/core-hunter/issues/388)) ([92addc4](https://github.com/efiten/core-hunter/commit/92addc49e3a4952a0d83c3bd109b3688f86ef869)), closes [#386](https://github.com/efiten/core-hunter/issues/386)

## [1.5.0](https://github.com/efiten/core-hunter/compare/web-v1.4.0...web-v1.5.0) (2026-08-15)


### Features

* **app,web:** carry the decoder's full packet-type set in the filter chips ([#343](https://github.com/efiten/core-hunter/issues/343)) ([e924935](https://github.com/efiten/core-hunter/commit/e924935728c677241dafe369ef18508223a9c339))
* **app,web:** extend the weak end of the RSSI scale below -110 dBm ([#344](https://github.com/efiten/core-hunter/issues/344)) ([29b1015](https://github.com/efiten/core-hunter/commit/29b101542f40857b99da3d299970de2f5f7b6e85))


### Bug Fixes

* **web:** hold a name-resolution redraw while a popup is open ([#354](https://github.com/efiten/core-hunter/issues/354)) ([369ddcf](https://github.com/efiten/core-hunter/commit/369ddcf8befb0b645f4e6e8f6caefc2822275a56))
* **web:** keep the map painted while a pan/zoom redraw is in flight ([#350](https://github.com/efiten/core-hunter/issues/350)) ([fcb32d0](https://github.com/efiten/core-hunter/commit/fcb32d0b623f7aeefac2dd66c9fd5f4bf80cbe48))
* **web:** stop filters.js and map.js racing — the page could die on load ([#361](https://github.com/efiten/core-hunter/issues/361)) ([caff818](https://github.com/efiten/core-hunter/commit/caff818e66220c2b09a50e3b8a1943b161e9c036))


### Documentation

* **web:** record what the ?v= buster covers, and the nginx policy it leans on ([#360](https://github.com/efiten/core-hunter/issues/360)) ([e21b209](https://github.com/efiten/core-hunter/commit/e21b20976ddb3147ec9971f876494d375ba4d33f))


### Tests

* **web:** close two diagnosed e2e flake sources — boot-window clicks and the per-test CDN fetch ([#352](https://github.com/efiten/core-hunter/issues/352)) ([fa9bec2](https://github.com/efiten/core-hunter/commit/fa9bec2412ccec2a609f9639594e8eff2ea19d8d))
* **web:** pin app&lt;-&gt;web parity for the duplicated modules ([#238](https://github.com/efiten/core-hunter/issues/238) option 2) ([#359](https://github.com/efiten/core-hunter/issues/359)) ([473e84e](https://github.com/efiten/core-hunter/commit/473e84e9293309bf8c2feefa42b4bb427bf990c3))

## [1.4.0](https://github.com/efiten/core-hunter/compare/web-v1.3.2...web-v1.4.0) (2026-08-08)


### Features

* **web:** generalize the target-list picker to the hunter filter ([#290](https://github.com/efiten/core-hunter/issues/290)) ([#313](https://github.com/efiten/core-hunter/issues/313)) ([8e34c51](https://github.com/efiten/core-hunter/commit/8e34c51eeccd21e75e369475fc575e66b9cf6658))

## [1.3.2](https://github.com/efiten/core-hunter/compare/web-v1.3.1...web-v1.3.2) (2026-08-08)


### Bug Fixes

* **web:** merge sender-picker rows for one node across id prefixes ([#331](https://github.com/efiten/core-hunter/issues/331)) ([#332](https://github.com/efiten/core-hunter/issues/332)) ([116c1a4](https://github.com/efiten/core-hunter/commit/116c1a407906bef6c7dfdb2fffe3cdd7157dd7f0))

## [1.3.1](https://github.com/efiten/core-hunter/compare/web-v1.3.0...web-v1.3.1) (2026-07-29)


### Bug Fixes

* refuse ambiguous prefixes and consult sender_kind on both sides ([#295](https://github.com/efiten/core-hunter/issues/295), [#296](https://github.com/efiten/core-hunter/issues/296)) ([#325](https://github.com/efiten/core-hunter/issues/325)) ([55a026f](https://github.com/efiten/core-hunter/commit/55a026fbc1bf8c213ce76d582620d596cd343f9b))
* **web:** reachable picker rows, live prefix input, honest guest range ([#298](https://github.com/efiten/core-hunter/issues/298), [#299](https://github.com/efiten/core-hunter/issues/299), [#300](https://github.com/efiten/core-hunter/issues/300)) ([#327](https://github.com/efiten/core-hunter/issues/327)) ([b5a552e](https://github.com/efiten/core-hunter/commit/b5a552ea362b81c884affbd51e9084cdbfbace1c))


### Continuous Integration

* add an eslint no-undef pass over app, web and nameresolver ([#303](https://github.com/efiten/core-hunter/issues/303)) ([#324](https://github.com/efiten/core-hunter/issues/324)) ([0eafdca](https://github.com/efiten/core-hunter/commit/0eafdca066e9728457d1da400c405fd4198f4f00))


### Tests

* **web:** route every spec through the shared e2e fixture ([#304](https://github.com/efiten/core-hunter/issues/304)) ([#329](https://github.com/efiten/core-hunter/issues/329)) ([d89b9eb](https://github.com/efiten/core-hunter/commit/d89b9ebfcf9e1debd5594e1b38b8bdfc0038bb5d))

## [1.3.0](https://github.com/efiten/core-hunter/compare/web-v1.2.1...web-v1.3.0) (2026-07-27)


### Features

* node-position layer — advertised positions vs. the RSSI estimate (app + web) ([#272](https://github.com/efiten/core-hunter/issues/272)) ([0c21df5](https://github.com/efiten/core-hunter/commit/0c21df553776034c9b461678d6ca16156d99f44f))
* **web,server:** browsable multi-select target-list picker ([#223](https://github.com/efiten/core-hunter/issues/223)) ([#288](https://github.com/efiten/core-hunter/issues/288)) ([184712b](https://github.com/efiten/core-hunter/commit/184712b101aa84a3aaf0b5adb2898c56f1daacef))
* **web:** add a live reception ticker, two-way synced with the map ([#224](https://github.com/efiten/core-hunter/issues/224)) ([#287](https://github.com/efiten/core-hunter/issues/287)) ([8165140](https://github.com/efiten/core-hunter/commit/8165140c99acf4db590997328eba243f62dea22c))
* **web:** Grafana-style time-range picker with relative ranges ([#285](https://github.com/efiten/core-hunter/issues/285)) ([#289](https://github.com/efiten/core-hunter/issues/289)) ([3270463](https://github.com/efiten/core-hunter/commit/3270463a84a5f272c943436ea7ccf91386455fbe))

## [1.2.1](https://github.com/efiten/core-hunter/compare/web-v1.2.0...web-v1.2.1) (2026-07-26)


### Bug Fixes

* **web:** add favicons to all four web entry points ([#234](https://github.com/efiten/core-hunter/issues/234)) ([#263](https://github.com/efiten/core-hunter/issues/263)) ([2e39fb9](https://github.com/efiten/core-hunter/commit/2e39fb9afe9f9f61917820e89a80c591d8b49510))
* **web:** match app's filter-chip visual language ([#225](https://github.com/efiten/core-hunter/issues/225)) ([#286](https://github.com/efiten/core-hunter/issues/286)) ([a7a41f4](https://github.com/efiten/core-hunter/commit/a7a41f407acd379a1b2977e827e3794ff86989fa))


### Miscellaneous Chores

* **web:** drop the unserved web/landing copy of the homepage ([#291](https://github.com/efiten/core-hunter/issues/291)) ([8c5f979](https://github.com/efiten/core-hunter/commit/8c5f979cf49d48ee2d018743ba40a455d3a4861b))

## [1.2.0](https://github.com/efiten/core-hunter/compare/web-v1.1.0...web-v1.2.0) (2026-07-13)


### Features

* **web:** expand #f-hunter to a multi-row listbox on focus ([#244](https://github.com/efiten/core-hunter/issues/244)) ([30ea9b0](https://github.com/efiten/core-hunter/commit/30ea9b04b0dd3c52971540b5adbced4ccffba412))


### Bug Fixes

* **app,web:** locate disclaimer, glossary, and copy parity ([#174](https://github.com/efiten/core-hunter/issues/174)) ([#227](https://github.com/efiten/core-hunter/issues/227)) ([41e1456](https://github.com/efiten/core-hunter/commit/41e1456eaf886350f534c91f7c0eb174010a4f14))
* **web:** fit the map to today's data on load instead of a Belgium-ish default ([#222](https://github.com/efiten/core-hunter/issues/222)) ([4ea1bb1](https://github.com/efiten/core-hunter/commit/4ea1bb1eaf51602cd6e94890596add3c88ef1fb0)), closes [#218](https://github.com/efiten/core-hunter/issues/218)
* **web:** stop persisting from/to date filter in localStorage ([#221](https://github.com/efiten/core-hunter/issues/221)) ([5bc0d30](https://github.com/efiten/core-hunter/commit/5bc0d3070a54eef3f488855502726e8cabad9107)), closes [#217](https://github.com/efiten/core-hunter/issues/217)

## [1.1.0](https://github.com/efiten/core-hunter/compare/web-v1.0.1...web-v1.1.0) (2026-07-11)


### Features

* **app:** Mesh-Hunter onboarding splash + display-name rename ([#202](https://github.com/efiten/core-hunter/issues/202)) ([c1d75c1](https://github.com/efiten/core-hunter/commit/c1d75c19ae85b32d0ded6aff687a0878864aaa9e))

## [1.0.1](https://github.com/efiten/core-hunter/compare/web-v1.0.0...web-v1.0.1) (2026-07-04)


### Bug Fixes

* **web:** only load Matomo on production hosts (not localhost/CI) ([1c70a7a](https://github.com/efiten/core-hunter/commit/1c70a7a85145bc688c2e21dc27d19dd457cb8294))


### Miscellaneous Chores

* add cookieless Matomo analytics to landing/map/app ([9b06bad](https://github.com/efiten/core-hunter/commit/9b06bad91e7fa8f3ce3de16f14c4dd04b23d6e36))

## [1.0.0](https://github.com/efiten/core-hunter/compare/web-v0.6.0...web-v1.0.0) (2026-07-04)


### Features

* **web:** login, role-aware map, admin page, and mesh-hunter.eu landing (v1.0) ([1be0c58](https://github.com/efiten/core-hunter/commit/1be0c58f8acfebe7603d685f1750ea71d44f9ab3))

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
