# Changelog

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
