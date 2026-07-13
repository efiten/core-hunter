# Changelog

## [1.3.0](https://github.com/efiten/core-hunter/compare/app-v1.2.0...app-v1.3.0) (2026-07-13)


### Features

* **app:** 3D mode — 2D/3D FAB, extruded hex bars, buildings, terrain ([#147](https://github.com/efiten/core-hunter/issues/147)) ([#228](https://github.com/efiten/core-hunter/issues/228)) ([75fb92e](https://github.com/efiten/core-hunter/commit/75fb92e3134145ec01dc7801f251838ef5d6d089))
* **app:** auto-discover toggle with pulse feedback and repeater trace-ping ([#241](https://github.com/efiten/core-hunter/issues/241)) ([83dea99](https://github.com/efiten/core-hunter/commit/83dea99805738f4fc46cd65df9fbce8f95f80ccf))
* **app:** GPS course as a third compass-mode heading source (driving mode) ([#245](https://github.com/efiten/core-hunter/issues/245)) ([6c09b26](https://github.com/efiten/core-hunter/commit/6c09b2617fb7824fa11b92037f867f2104f1e0e0))


### Bug Fixes

* **app,web:** locate disclaimer, glossary, and copy parity ([#174](https://github.com/efiten/core-hunter/issues/174)) ([#227](https://github.com/efiten/core-hunter/issues/227)) ([41e1456](https://github.com/efiten/core-hunter/commit/41e1456eaf886350f534c91f7c0eb174010a4f14))
* **app:** clarify login/register submit action, keep it above the keyboard ([#239](https://github.com/efiten/core-hunter/issues/239)) ([0255490](https://github.com/efiten/core-hunter/commit/0255490ac8863903ea4bac6e17d08b863dec60f1))
* **app:** lighter help-overlay backdrop, click-outside dismiss, splash tagline, anchored tooltips ([#220](https://github.com/efiten/core-hunter/issues/220)) ([addd30a](https://github.com/efiten/core-hunter/commit/addd30aa15ff1971759abcdcc7c671f1c6ea652c)), closes [#216](https://github.com/efiten/core-hunter/issues/216)
* **app:** stop follow-mode recenter from cancelling an active pinch-zoom ([#243](https://github.com/efiten/core-hunter/issues/243)) ([d92cd28](https://github.com/efiten/core-hunter/commit/d92cd2803b67790e55b91746325ee86b374940fe))
* **app:** two-line target rows to fix id/RSSI overlap and improve name legibility ([#219](https://github.com/efiten/core-hunter/issues/219)) ([d800486](https://github.com/efiten/core-hunter/commit/d80048641f894ac0409a295d68799c37ce194d21)), closes [#215](https://github.com/efiten/core-hunter/issues/215)


### Styles

* **app:** standardize glossary and copy wording ([#174](https://github.com/efiten/core-hunter/issues/174)) ([#226](https://github.com/efiten/core-hunter/issues/226)) ([8c57469](https://github.com/efiten/core-hunter/commit/8c57469f7bc402bb8330d2a3300c28e4a919a793))

## [1.2.0](https://github.com/efiten/core-hunter/compare/app-v1.1.1...app-v1.2.0) (2026-07-11)


### Features

* **app:** Mesh-Hunter onboarding splash + display-name rename ([#202](https://github.com/efiten/core-hunter/issues/202)) ([c1d75c1](https://github.com/efiten/core-hunter/commit/c1d75c19ae85b32d0ded6aff687a0878864aaa9e))
* **app:** migrate the map to MapLibre GL — 2D parity ([#147](https://github.com/efiten/core-hunter/issues/147) phase 1) ([#214](https://github.com/efiten/core-hunter/issues/214)) ([cb05ab3](https://github.com/efiten/core-hunter/commit/cb05ab3dd7c929d87415037608a529516d597693))
* **app:** multi-select targets + byte-prefix in the target list ([#206](https://github.com/efiten/core-hunter/issues/206)) ([742252a](https://github.com/efiten/core-hunter/commit/742252acd99f4006225c0548afc096ee2ba1f7a0))
* **app:** new Mesh-Hunter app icon (hex · reticle · thermal signal) ([#205](https://github.com/efiten/core-hunter/issues/205)) ([1f23045](https://github.com/efiten/core-hunter/commit/1f23045e194070fc5beaf69f94f769b8f95719c5))
* **app:** settings as a full page with Settings / About tabs ([#207](https://github.com/efiten/core-hunter/issues/207)) ([76f549d](https://github.com/efiten/core-hunter/commit/76f549d7dc8036f782cc06b57831d85816244058))

## [1.1.1](https://github.com/efiten/core-hunter/compare/app-v1.1.0...app-v1.1.1) (2026-07-04)


### Bug Fixes

* **web:** only load Matomo on production hosts (not localhost/CI) ([1c70a7a](https://github.com/efiten/core-hunter/commit/1c70a7a85145bc688c2e21dc27d19dd457cb8294))


### Miscellaneous Chores

* add cookieless Matomo analytics to landing/map/app ([9b06bad](https://github.com/efiten/core-hunter/commit/9b06bad91e7fa8f3ce3de16f14c4dd04b23d6e36))

## [1.1.0](https://github.com/efiten/core-hunter/compare/app-v1.0.0...app-v1.1.0) (2026-07-04)


### Features

* **app:** compass FAB icon previews the next state, not the current one ([63f6671](https://github.com/efiten/core-hunter/commit/63f6671b37045c223b498d71cf6fece916f6a84b))
* **app:** draw the hunter's own session route trail on the map ([cd8f0e3](https://github.com/efiten/core-hunter/commit/cd8f0e3eb3b7e73a4eceda9b81ef64888518c82c))
* **app:** topbar redesign — Select-target chip, filter dropdown, locate over the filtered set ([#128](https://github.com/efiten/core-hunter/issues/128)) ([5f62978](https://github.com/efiten/core-hunter/commit/5f62978db5b71984f3a90d0a2f64673868dceec0))

## [1.0.0](https://github.com/efiten/core-hunter/compare/app-v0.14.1...app-v1.0.0) (2026-07-04)


### Features

* **app:** in-app register/login and companion linking (v1.0) ([00514a9](https://github.com/efiten/core-hunter/commit/00514a9314d6a21c7bae4ad92631483c63821396))

## [0.14.1](https://github.com/efiten/core-hunter/compare/app-v0.14.0...app-v0.14.1) (2026-07-03)


### Bug Fixes

* **app:** correct leaflet-rotate's renderer zoom transform to stop drift ([#168](https://github.com/efiten/core-hunter/issues/168)) ([a0f6093](https://github.com/efiten/core-hunter/commit/a0f6093e6d38f98dc8fa1e4b223462c6ef947405))

## [0.14.0](https://github.com/efiten/core-hunter/compare/app-v0.13.0...app-v0.14.0) (2026-07-02)


### Features

* **app:** fade reception points with age instead of hard-vanishing ([#164](https://github.com/efiten/core-hunter/issues/164)) ([cf9a62b](https://github.com/efiten/core-hunter/commit/cf9a62b3996384f0ff38acf011b5fef7e46ad54f))
* **app:** make the Messages-panel ignore button a toggle ([#165](https://github.com/efiten/core-hunter/issues/165)) ([228ce93](https://github.com/efiten/core-hunter/commit/228ce93912283be5745f7920f434cae0b49b7dd4))


### Bug Fixes

* **app:** show discover responses in the Messages panel ([#166](https://github.com/efiten/core-hunter/issues/166)) ([2e8c2c7](https://github.com/efiten/core-hunter/commit/2e8c2c707ad8078c3e817a952cca63b486c14992))

## [0.13.0](https://github.com/efiten/core-hunter/compare/app-v0.12.0...app-v0.13.0) (2026-07-02)


### Features

* **app:** Settings reload button with deploy version check ([#162](https://github.com/efiten/core-hunter/issues/162)) ([0b4702e](https://github.com/efiten/core-hunter/commit/0b4702e3e1bf7c1991a15e81046a5f45b2682896))

## [0.12.0](https://github.com/efiten/core-hunter/compare/app-v0.11.0...app-v0.12.0) (2026-07-02)


### Features

* **app:** auto-fade the locate-info box after 2s ([#127](https://github.com/efiten/core-hunter/issues/127)) ([3f887d1](https://github.com/efiten/core-hunter/commit/3f887d1351bf5ad38018cc3a5ecf5ed72d3a36ec))
* **app:** distinct icon for the combined points+hex layer mode ([#126](https://github.com/efiten/core-hunter/issues/126)) ([07092f9](https://github.com/efiten/core-hunter/commit/07092f92d23348d4e9957873d25d970c3204069f))
* **app:** focus the existing PWA instance instead of relaunching ([#153](https://github.com/efiten/core-hunter/issues/153)) ([bba418a](https://github.com/efiten/core-hunter/commit/bba418a43c83e14a78a8370aed4094312ddabd95))
* **app:** manual pause/resume for the MQTT connection ([#121](https://github.com/efiten/core-hunter/issues/121)) ([496406c](https://github.com/efiten/core-hunter/commit/496406c81766b58f725e87a146c4c40d1f57968e))
* **app:** mark individual non-default settings within the sheets ([#110](https://github.com/efiten/core-hunter/issues/110)) ([a2f1dfa](https://github.com/efiten/core-hunter/commit/a2f1dfab790889d01886439c8524dc25cee5d9de))
* **app:** mark the selected target active in the target list ([#108](https://github.com/efiten/core-hunter/issues/108)) ([208920a](https://github.com/efiten/core-hunter/commit/208920ac75eefb77d5175942cf2d9c7b122be972))
* **app:** real map rotation on device heading + two-finger rotate gesture ([#151](https://github.com/efiten/core-hunter/issues/151)) ([033033b](https://github.com/efiten/core-hunter/commit/033033bb657891a83155ae414a59556af818fe1d))
* **app:** replace settings-btn emoji with an inline SVG gear icon ([#113](https://github.com/efiten/core-hunter/issues/113)) ([3e4c241](https://github.com/efiten/core-hunter/commit/3e4c2414a24bbe36a6acd6fab2e5eb66460e1bb5))
* **app:** show splash disclaimer + tips on every visible screen ([#123](https://github.com/efiten/core-hunter/issues/123)) ([21d8bc6](https://github.com/efiten/core-hunter/commit/21d8bc6c818f1c2634fb7a02a476e893d851c94c))
* **app:** tap outside filter/settings/target sheets to close ([#111](https://github.com/efiten/core-hunter/issues/111)) ([b6dbb3f](https://github.com/efiten/core-hunter/commit/b6dbb3f5ad111706a0f204c58f3f00915c63acb6))
* **app:** toggle FAB for the single-hunter locate overlay ([#120](https://github.com/efiten/core-hunter/issues/120)) ([aa95e7d](https://github.com/efiten/core-hunter/commit/aa95e7d38ec1dd8f7f853555ac56d74891533b09))


### Bug Fixes

* **app:** direct-only filter must check hops === 0, not is_direct ([#150](https://github.com/efiten/core-hunter/issues/150)) ([66301e1](https://github.com/efiten/core-hunter/commit/66301e1825c381331a4a13ec1d7bed4c005bff19))
* **app:** disable pull-to-refresh (breaks active BLE/MQTT connection) ([#133](https://github.com/efiten/core-hunter/issues/133)) ([6adb347](https://github.com/efiten/core-hunter/commit/6adb347b9b96ccaee29f7991449ff08be7e621bd))
* **app:** ignore-sender updates the map immediately ([#112](https://github.com/efiten/core-hunter/issues/112)) ([355e809](https://github.com/efiten/core-hunter/commit/355e809945b6db980198096a7b51df3ed07edfdb))
* **app:** raise map maxZoom from 19 to 20 ([#107](https://github.com/efiten/core-hunter/issues/107)) ([475ab1b](https://github.com/efiten/core-hunter/commit/475ab1bb03462a06795515b3645411995fc1fd8b))
* **app:** render points above the hex layer in 'both' mode ([#125](https://github.com/efiten/core-hunter/issues/125)) ([963871d](https://github.com/efiten/core-hunter/commit/963871d8147bf3fb2459ca1b55f06834a8c185b0))
* **app:** resolve relayed-advert prefixes to repeater names ([#137](https://github.com/efiten/core-hunter/issues/137)) ([6a5037a](https://github.com/efiten/core-hunter/commit/6a5037abd8bbbc52fa49db872cd8d9a37a0ff705)), closes [#136](https://github.com/efiten/core-hunter/issues/136)
* **app:** Settings connect/disconnect button stays disabled after connecting ([#124](https://github.com/efiten/core-hunter/issues/124)) ([986a275](https://github.com/efiten/core-hunter/commit/986a275fb5760f76db1e32e62dc9e972d9a0ac40))


### Documentation

* **app:** document required publish-only broker ACL ([#154](https://github.com/efiten/core-hunter/issues/154)) ([f80459a](https://github.com/efiten/core-hunter/commit/f80459a24cf42fa09ea502480ca3f85c8b400e4a))


### Miscellaneous Chores

* **app:** remove the Manual position (dev) debug feature ([#122](https://github.com/efiten/core-hunter/issues/122)) ([5e43aa7](https://github.com/efiten/core-hunter/commit/5e43aa753636aff6d1a1896d6a7435e5dd2644d7))

## [0.11.0](https://github.com/efiten/core-hunter/compare/app-v0.10.0...app-v0.11.0) (2026-07-01)


### Features

* **app:** single-hunter locate for the isolated target (pwa) ([#92](https://github.com/efiten/core-hunter/issues/92)) ([ebe93bb](https://github.com/efiten/core-hunter/commit/ebe93bb5121548042d4cd5b7afaa20a4f2043fc0))


### Bug Fixes

* **app:** active state for the Messages panel isolate-sender button ([#89](https://github.com/efiten/core-hunter/issues/89)) ([5f756e1](https://github.com/efiten/core-hunter/commit/5f756e1de0813991d65f630a9d2e81ddcb335967))
* **app:** compass-mode toggle for the map recenter button (pwa) ([#88](https://github.com/efiten/core-hunter/issues/88)) ([f7cd13f](https://github.com/efiten/core-hunter/commit/f7cd13f5e637f9b47fc9b446fa3e5891cc336292))
* **app:** default Direct-only filter to off ([#90](https://github.com/efiten/core-hunter/issues/90)) ([db65239](https://github.com/efiten/core-hunter/commit/db65239226954a4d894f03e2c6b4623fa2b87daf))
* **app:** prevent text-selection tap-to-search on row buttons (Android) ([#84](https://github.com/efiten/core-hunter/issues/84)) ([9723b2d](https://github.com/efiten/core-hunter/commit/9723b2d39a462f88e9db4a4d49e1521880ae6218))
* **app:** swap layer-toggle FAB icon per active layer mode ([#87](https://github.com/efiten/core-hunter/issues/87)) ([a720d4c](https://github.com/efiten/core-hunter/commit/a720d4cfb869407d186b910009010093d1c86ad3))
* **app:** unify Settings connection button (connect/disconnect/retry) ([#86](https://github.com/efiten/core-hunter/issues/86)) ([9d1adbd](https://github.com/efiten/core-hunter/commit/9d1adbdb8143db9e3963cb1537217ebcd0a0b45b))

## [0.10.0](https://github.com/efiten/core-hunter/compare/app-v0.9.0...app-v0.10.0) (2026-07-01)


### Features

* **app:** rotating tips on the GPS-wait splash ([#83](https://github.com/efiten/core-hunter/issues/83)) ([b1605bf](https://github.com/efiten/core-hunter/commit/b1605bf04d5d0f0b89d04d412c0e9465c4f50af2))


### Bug Fixes

* **app:** include last-hop repeaters in the target dropdown ([#76](https://github.com/efiten/core-hunter/issues/76)) ([92d1c2c](https://github.com/efiten/core-hunter/commit/92d1c2c644302c4923c6d66018cb4c76b1591fe1))

## [0.9.0](https://github.com/efiten/core-hunter/compare/app-v0.8.0...app-v0.9.0) (2026-07-01)


### Features

* **app:** make the PWA installable (register SW, add icons + meta) ([#27](https://github.com/efiten/core-hunter/issues/27)) ([d7155df](https://github.com/efiten/core-hunter/commit/d7155dfa1a79fd3352a54921bac9584825b9b06f))

## [0.8.0](https://github.com/efiten/core-hunter/compare/app-v0.7.0...app-v0.8.0) (2026-07-01)


### Features

* **app:** read companion spreading factor and show it in settings ([#52](https://github.com/efiten/core-hunter/issues/52)) ([b60ad80](https://github.com/efiten/core-hunter/commit/b60ad8055e373c37a187bd9563a785c81c5fc85a))


### Documentation

* dedupe release changelogs (drop merge-commit duplicates) ([#70](https://github.com/efiten/core-hunter/issues/70)) ([10d0528](https://github.com/efiten/core-hunter/commit/10d0528017a72cdc4db530dafaf157a37bb7487f))

## [0.7.0](https://github.com/efiten/core-hunter/compare/app-v0.6.0...app-v0.7.0) (2026-07-01)


### Features

* **app:** attenuator compensation added back to plotted RSSI ([5a6deb7](https://github.com/efiten/core-hunter/commit/5a6deb71ee45bf51272c9bd8ce295b5274ed246d)), closes [#54](https://github.com/efiten/core-hunter/issues/54)
* **app:** capture FLOOD last-hop relay (path[last]) as a directly-heard node ([f08e88a](https://github.com/efiten/core-hunter/commit/f08e88af3d6acbe170fbf51c87157a8957feeb29)), closes [#64](https://github.com/efiten/core-hunter/issues/64)
* **app:** move settings to the top bar, Discover as a radar-icon FAB above the filter ([3f2378f](https://github.com/efiten/core-hunter/commit/3f2378f49d8fd2117d67f6d226c59d92ecb7a554)), closes [#45](https://github.com/efiten/core-hunter/issues/45)
* **app:** startup splash + GPS-loading indicator ([75fc9bf](https://github.com/efiten/core-hunter/commit/75fc9bfc470f2cc75fc52bcfd193d9285568a6da))
* **app:** target dropdown with pinned top senders ([a76da15](https://github.com/efiten/core-hunter/commit/a76da1541e1de51bce7a3687f8d172a273977f67))
* **app:** treat the ignore-list as a filter (move to filter sheet, light filter FAB) ([82dc174](https://github.com/efiten/core-hunter/commit/82dc174959dda9d57da3539908a17f8a7dc09408)), closes [#48](https://github.com/efiten/core-hunter/issues/48)
* identify every zero-hop node (advert + discover) by ID + role, resolve name via API ([3728f26](https://github.com/efiten/core-hunter/commit/3728f262d84fbeab984d130e0979422326532db9)), closes [#41](https://github.com/efiten/core-hunter/issues/41)


### Bug Fixes

* **app:** add missing styles for the radio settings section ([f93f158](https://github.com/efiten/core-hunter/commit/f93f1588f5cc8df48d50efddcd98ba65a6d0c3cc))
* **app:** don't let MQTT connect failure abort the BLE connect ([984afdf](https://github.com/efiten/core-hunter/commit/984afdf9d3c6d0c7729645a934c11dbe8e0ec67e))
* **app:** keep the hex-heat grid aligned during zoom (rebuild on zoomend, not mid-animation) ([bd00863](https://github.com/efiten/core-hunter/commit/bd00863866185c1fd56cefecfe44ada4a8a7ab81)), closes [#44](https://github.com/efiten/core-hunter/issues/44)

## [0.6.0](https://github.com/efiten/core-hunter/compare/app-v0.5.0...app-v0.6.0) (2026-06-30)


### Features

* **app,web:** resolve node names from CoreScope for full-pubkey senders ([197fc5a](https://github.com/efiten/core-hunter/commit/197fc5a399f6655c240951cea086bf56d891fcd1))
* **app:** filter-active indicator + filter sheet layout ([776eaf9](https://github.com/efiten/core-hunter/commit/776eaf94c727737c3ce4823f56a61857a420db13))
* **app:** HUD timer showing time since last packet ([6face72](https://github.com/efiten/core-hunter/commit/6face721eb117396ee3c6f866a9457993a13b2e6))
* **app:** move Disconnect into BLE settings, keep Connect in the HUD ([3db3fdc](https://github.com/efiten/core-hunter/commit/3db3fdc3baefb4bf101f2cdbfbbff378de2730d8))
* **app:** scale hex resolution with zoom (down to 3 m) ([0192d97](https://github.com/efiten/core-hunter/commit/0192d97aa90ee1293b3b04987f161d9109f87de6))


### Bug Fixes

* **app:** prevent Chrome auto-translate from rewriting the UI ([ae20e57](https://github.com/efiten/core-hunter/commit/ae20e57169252753d0bded964b01c5de10e769f3))


### Styles

* **app:** themed X close button in overlay sheets ([8fe485b](https://github.com/efiten/core-hunter/commit/8fe485b3b958e08f5cbeac670c8a5846d8e0baa4))

## [0.5.0](https://github.com/efiten/core-hunter/compare/app-v0.4.0...app-v0.5.0) (2026-06-30)


### Features

* **app:** keep screen awake during drive — Wake Lock ([#17](https://github.com/efiten/core-hunter/issues/17)) ([bb19d42](https://github.com/efiten/core-hunter/commit/bb19d429ea5ee890e73706632bc6f376cb6a088e))

## [0.4.0](https://github.com/efiten/core-hunter/compare/app-v0.3.0...app-v0.4.0) (2026-06-30)


### Features

* **app:** single-shot Discover button; remove redundant hop pill ([#14](https://github.com/efiten/core-hunter/issues/14)) ([a93d344](https://github.com/efiten/core-hunter/commit/a93d3442f17b898726bebd67e727ae5020f7f761))

## [0.3.0](https://github.com/efiten/core-hunter/compare/app-v0.2.0...app-v0.3.0) (2026-06-29)


### Features

* **app:** hashtag-channel decoding from a config channel-name list ([#11](https://github.com/efiten/core-hunter/issues/11)) ([e9d4449](https://github.com/efiten/core-hunter/commit/e9d44499d8a4a3ee49eb778b1580ad26045e2082))

## [0.2.0](https://github.com/efiten/core-hunter/compare/app-v0.1.0...app-v0.2.0) (2026-06-29)


### Features

* **app:** live Messages feed — decrypted channel messages + adverts ([#8](https://github.com/efiten/core-hunter/issues/8)) ([7af52b7](https://github.com/efiten/core-hunter/commit/7af52b76c0635cc11a11165133bcca746576a4c2))
