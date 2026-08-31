# Changelog

## [0.1.7](https://github.com/hoardodile/hoardodile/compare/v0.1.6...v0.1.7) (2026-08-31)

### Features

* **workbench:** res-card chrome redesign + faithful card preview ([19c1030](https://github.com/hoardodile/hoardodile/commit/19c10309754121052d454d97810bfcbdcf82f6d3))
* **workbench:** res-card preview via shared template renderer ([880306b](https://github.com/hoardodile/hoardodile/commit/880306b75a902f3cfc7e5358f904da417ae4069e))

### Bug Fixes

* **desktop:** make the resource-update e2e responsive-aware ([dad0b56](https://github.com/hoardodile/hoardodile/commit/dad0b56b3c9be9f255486d025d8dfd6f7fce668c))
* **marketplace:** move the card version requirement into its footer strip ([6356a17](https://github.com/hoardodile/hoardodile/commit/6356a17f39c4087c1ad507d64603a3455591fe36))
* **scripts:** wait for the doc editor to render before capture ([cee787a](https://github.com/hoardodile/hoardodile/commit/cee787ab7e75bbcf0dc257700a49bf54d4f3ee71))

## [0.1.6](https://github.com/hoardodile/hoardodile/compare/v0.1.5...v0.1.6) (2026-08-31)

### ⚠ BREAKING CHANGES

* **marketplace:** release assets are README.md / README.<locale>.md (was intro.<locale>.md); the old intro form is no longer recognized.

### Features

* **cli:** show a prominent workbench URL banner in plugin dev ([10adbd0](https://github.com/hoardodile/hoardodile/commit/10adbd026ec34d4e7f1fa554b5f70dfd4398c81d))
* **marketplace:** fall back to the releases feed under a rate limit ([6389931](https://github.com/hoardodile/hoardodile/commit/63899312f548f2f464be5a467f67a70c716ecc0d))
* **marketplace:** rename plugin intro to README with bare fallback ([1e9594a](https://github.com/hoardodile/hoardodile/commit/1e9594a243b15a4e3f0eb80e999916de308950f9))
* **sdk-web:** add cover upload to the plugin render layer ([b308993](https://github.com/hoardodile/hoardodile/commit/b308993603fec3f5f6733f03656ad403dad500c6))
* **workbench:** reset plugin settings and clear plugin cache in Configure ([45a20b2](https://github.com/hoardodile/hoardodile/commit/45a20b2307345a369297050ec4ce2d97542c8127))
* **workbench:** support an onReady hook on serveWorkbench ([860c1ab](https://github.com/hoardodile/hoardodile/commit/860c1ab0fd89af5903597a9d87344f145d445f90))

### Bug Fixes

* **desktop:** keep the resource-pack shell hash on one shell-runtime boundary ([fefc5cf](https://github.com/hoardodile/hoardodile/commit/fefc5cf22b17e9c8831b68fcbb39d7c1e3f880a2))
* **server:** reuse file tokens so plugin preview content URLs stay stable ([46ef663](https://github.com/hoardodile/hoardodile/commit/46ef663ff8554949c4f71a4f7423cde41e2d1eee))
* **web:** make the service worker resource-content cache route match ([c4a80b3](https://github.com/hoardodile/hoardodile/commit/c4a80b386b6c36a25e0a5b572e04a11a20ff3ec2))

## [0.1.5](https://github.com/hoardodile/hoardodile/compare/v0.1.4...v0.1.5) (2026-08-30)

### Features

* **desktop:** hot-update content releases and reopen instead of restart ([451b770](https://github.com/hoardodile/hoardodile/commit/451b770f937c501c7df365a6e798ecbf1c3e7d1e))
* **res:** bulk-replace a content plugin with a target detect gate ([66b4e03](https://github.com/hoardodile/hoardodile/commit/66b4e0300934c311aa7828cf7616154d5560b7b7))
* **web:** search the plugin marketplace by name and description ([3b70e3f](https://github.com/hoardodile/hoardodile/commit/3b70e3f2ab2cc2ff2230dd40ab22896ca1194d86))

### Bug Fixes

* **marketplace:** let the manual refresh bypass the release rate-limit cooldown ([1e7cd00](https://github.com/hoardodile/hoardodile/commit/1e7cd0029bdca48433a843457504c2e978a4f979))
* **res:** truncate a leftover plugin id in the basic-info selector ([db78537](https://github.com/hoardodile/hoardodile/commit/db78537bb8fca1ebf24683e6a205020bff98d4d3))
* **web:** show a visible document-editor skeleton while the body loads ([1cee3cf](https://github.com/hoardodile/hoardodile/commit/1cee3cf8a0082735f2b099e3cfca8249886b5ee0))

## [0.1.4](https://github.com/hoardodile/hoardodile/compare/v0.1.3...v0.1.4) (2026-08-29)

### Features

* **marketplace:** render release intro images and gate the intro folder ([e8892fa](https://github.com/hoardodile/hoardodile/commit/e8892fa16551988f936fd29126286d344a587616))
* **scripts:** capture demo screenshots per UI language ([959f158](https://github.com/hoardodile/hoardodile/commit/959f158313e8a57361be6a4d0dc3591a95bfbcb8))
* **server:** make the plugin-marketplace cache windows env-configurable ([c2a68f7](https://github.com/hoardodile/hoardodile/commit/c2a68f71a9e4fe0379b00c197ac3a611edfe5747))
* **workbench:** plugin dev chrome - modes, info, fullscreen, live theme sync ([f9b4948](https://github.com/hoardodile/hoardodile/commit/f9b494858e89d23f18600bc2530063f40c46347e)), references [#hook-status](https://github.com/hoardodile/hoardodile/issues/hook-status)

### Bug Fixes

* **desktop:** pass the derived window bounds into the main-process poll evaluate ([f0ca423](https://github.com/hoardodile/hoardodile/commit/f0ca423ed4fe88b0e7cf9b2e43fb5d9749da5664))
* **ui:** close popover on window blur via opt-in closeOnBlur ([a0de987](https://github.com/hoardodile/hoardodile/commit/a0de987d45d332afe7764abc3882f555c66291c1))
* **workbench:** bind the i18n default instance and rebind on port conflict ([073b398](https://github.com/hoardodile/hoardodile/commit/073b398a865973f1182216a6f6b809793d077957))

## [0.1.3](https://github.com/hoardodile/hoardodile/compare/v0.1.2...v0.1.3) (2026-08-29)

### Features

* **create-plugin:** add release-it one-click publish to the plugin template ([cc51313](https://github.com/hoardodile/hoardodile/commit/cc51313d1257e7d233e6cd82c25e3746ebd94504))
* **desktop:** persist and restore the app window bounds and maximized state ([313ff34](https://github.com/hoardodile/hoardodile/commit/313ff3498c9dc17cbecad07d9bc182b08b4a5970))
* **host:** tag storage layout and versioned folder-ops support ([b08e70f](https://github.com/hoardodile/hoardodile/commit/b08e70f2c321358488f8938de15d5e3390c26e11))
* **plugins:** post-install onInstall hook for one-shot consent-gated downloads ([62183a0](https://github.com/hoardodile/hoardodile/commit/62183a0745b116a2dbd2d3318a3c2a86b48de5bc))
* **server:** tag art slots, external link and archive-aware deletion ([434a49c](https://github.com/hoardodile/hoardodile/commit/434a49cd407f19a4927801c92d29ea705e67da67))
* **web:** per-plugin marketplace update dots and cross-registry update provenance ([2679f88](https://github.com/hoardodile/hoardodile/commit/2679f8874ac50931100b636b3e962106b806e950))
* **web:** prefetched infinite masonry for resource search ([7eb1be7](https://github.com/hoardodile/hoardodile/commit/7eb1be721c2fa4f3ebb7cf6d6ef0fc5920bfadc1))
* **web:** tag link and art editing with hover preview cards ([4540ea0](https://github.com/hoardodile/hoardodile/commit/4540ea0f0bde268191489fe9cf65623ae5f4e3d2))
* **web:** unify tag hover previews and move art editing to the card ([c92b2c9](https://github.com/hoardodile/hoardodile/commit/c92b2c9d12c8dd0bcc8ca0e173affec4c3d0dd0a))

### Bug Fixes

* **desktop:** stop offering Copy LAN address in the tray menu ([1652dbb](https://github.com/hoardodile/hoardodile/commit/1652dbbb8038faac7af59d50a857c64918d8342a))
* **server:** retry transient Windows renames during plugin installs ([4016080](https://github.com/hoardodile/hoardodile/commit/401608084d946d1e3aab5ad4158fb17391d1750d))
* **server:** trust authed plugin asset requests for consent delivery ([3234795](https://github.com/hoardodile/hoardodile/commit/323479569319108ed882f45a2159568a8ee4e470))
* **web:** deliver plugin download consent without depending on the SSE stream ([48f6303](https://github.com/hoardodile/hoardodile/commit/48f63039eb3ddbfcabf41e82c411353a6a66b489))
* **web:** hard-cut the boot splash to the app ([ec1270c](https://github.com/hoardodile/hoardodile/commit/ec1270c9f85683858e2b877de5c19365bd2a926f))
* **web:** keep the tag preview hover state self-managed ([652dfe8](https://github.com/hoardodile/hoardodile/commit/652dfe87fd751552575daea6f67d20c9f4a7c4d9))
* **web:** make plugin download consent usable over plugin previews ([0d3572c](https://github.com/hoardodile/hoardodile/commit/0d3572cceb03f857823e63bd0ed560fae273c7c8))
* **web:** rename the shell-cache surface to app temporary files ([559d177](https://github.com/hoardodile/hoardodile/commit/559d1770c11ae08d5719b1b29276b92c0defa183))
* **web:** seat the marketplace function key at an outer footer edge ([514ecd5](https://github.com/hoardodile/hoardodile/commit/514ecd52b0021790984ce622df373dbef0ed807e))
* **web:** unclip marketplace update dots and seat them on the button corner ([9a8888d](https://github.com/hoardodile/hoardodile/commit/9a8888db8fc75e0e20aa7c7c68292e43dec58e1c))
* **workbench:** reject private IP-literal vault targets like the app server ([8f97676](https://github.com/hoardodile/hoardodile/commit/8f97676acb98e7f8ae6821d5fdbf57f63c6c1814))

## [0.1.2](https://github.com/hoardodile/hoardodile/compare/v0.1.1...v0.1.2) (2026-08-27)

### Features

* collect client logs, fix directional scroll restore, and add the in-app error page ([c53158c](https://github.com/hoardodile/hoardodile/commit/c53158ce8021946ba0c592a80a16d0f8bc21e428))
* **desktop:** single-document boot — the SPA splash is the loading surface ([8fbe2cf](https://github.com/hoardodile/hoardodile/commit/8fbe2cfbecaf3f2318cfb0ba465febc020b224fb)), references [#0d0d0d](https://github.com/hoardodile/hoardodile/issues/0d0d0d) [#060606](https://github.com/hoardodile/hoardodile/issues/060606)
* **marketplace:** intro + release-notes detail tabs, bundled plugin offline restore ([d50d9cc](https://github.com/hoardodile/hoardodile/commit/d50d9ccc1f02fcf9c3e552606ffeb94bc377e0ad))
* plugin marketplace full experience ([b6a0bb5](https://github.com/hoardodile/hoardodile/commit/b6a0bb52af9543d33fe05b9f3395e399fce03239))
* **server:** make hoardodile/marketplace the default plugin registry ([bb14587](https://github.com/hoardodile/hoardodile/commit/bb145875de7b0f5a47e95dcebb21c482fc9b1241))
* **server:** unify project zips on yauzl/yazl, enforce zip-only plugin installs ([c5bbca6](https://github.com/hoardodile/hoardodile/commit/c5bbca68e27b6267f4357a64abe537b403db3b32))
* unify outbound proxy handling and redesign the plugin marketplace ([b978187](https://github.com/hoardodile/hoardodile/commit/b97818746cabe71b9f0431785cff92698a97ab97))
* **web:** add marketplace entry to the sidebar nav ([39f4d73](https://github.com/hoardodile/hoardodile/commit/39f4d73605eb0e87b5465c3c7dbfb1aa91d44ace))
* **web:** bundle redacted app and server logs into a downloadable archive ([0cfe649](https://github.com/hoardodile/hoardodile/commit/0cfe64949e1325cb5ff315dd8cfd062124672c01))
* **web:** move bundled-plugins restore section to the plugins settings page ([5d6e999](https://github.com/hoardodile/hoardodile/commit/5d6e99934601551e5b9147bb6fa56e0bfda737ad))
* **web:** paginate recent connections ([d068e46](https://github.com/hoardodile/hoardodile/commit/d068e46ede1285af11e1132dd65715e92b79a5b0))

### Bug Fixes

* **ci:** give the docker build a git repo and the gha cache driver ([5766c35](https://github.com/hoardodile/hoardodile/commit/5766c3514d3fe17e6506900bc20f09da87406a02))
* **ci:** keep the desktop manifest in the docker build context ([7ef837e](https://github.com/hoardodile/hoardodile/commit/7ef837ed0c12a392160a7da44b5f9ddf954f97db))
* **desktop:** reload the resolved sidecar URL after a resource swap ([240a3a6](https://github.com/hoardodile/hoardodile/commit/240a3a699ff13bc8f148e4d45afb427426438259))
* **sync:** diff the live library state against each device's last sync ([1eabe82](https://github.com/hoardodile/hoardodile/commit/1eabe826ae968e5520b9c206943fdbfc93f95077))
* **web:** carry anchor payload as arbitrary JSON in pluginState ([1c99d31](https://github.com/hoardodile/hoardodile/commit/1c99d317c1d3d001af9575b39cdf1d67ee3135c7))
* **web:** keep the external base URL port for the e2e API helpers ([5747f1d](https://github.com/hoardodile/hoardodile/commit/5747f1df628005e527e6c12e26cc6e5c087b5d51))
* **web:** navigate message anchor jumps in-app without reloading ([07d2440](https://github.com/hoardodile/hoardodile/commit/07d24407d2dd137ceae007f518f8993ab4657409))
* **web:** regenerate the solar glyph index before the e2e run ([c3b5100](https://github.com/hoardodile/hoardodile/commit/c3b5100d3024bed85dd4bcb53e195aade63e4bb7))
* **web:** reset app scroll position on untracked route arrival ([8e0340e](https://github.com/hoardodile/hoardodile/commit/8e0340eb517e0029cb3e29252e9422bdaa0d3b46))

## [0.1.1](https://github.com/hoardodile/hoardodile/compare/v0.1.0...v0.1.1) (2026-08-26)

### Features

* **cli:** package plugins for GitHub releases with sha256 artifacts ([ac93856](https://github.com/hoardodile/hoardodile/commit/ac938561bc1eb8d95249e063d391b1ed58632ff5))
* **create-plugin:** tag-triggered release workflow in the plugin template ([517892d](https://github.com/hoardodile/hoardodile/commit/517892db5e6f8ee62153a097e5c91e8d3c6e07dd))
* **desktop:** lock-on-close sign-in, reopen continuity, LAN polish ([674cb5a](https://github.com/hoardodile/hoardodile/commit/674cb5a0f69b8dc4611bfc9dae17c14bae3224cf))
* **desktop:** unified logo-only loading states ([dcccdda](https://github.com/hoardodile/hoardodile/commit/dcccdda25d200fb008c258c5cb399cb90aa53276))
* **sdk-types:** batched plugin downloads with one consent dialog ([7555cc2](https://github.com/hoardodile/hoardodile/commit/7555cc25170a7bfaf82e99d1cac5dd7dc08b3cdd))
* **server:** GitHub-release plugin marketplace ([c0b70a4](https://github.com/hoardodile/hoardodile/commit/c0b70a41606c6246d827b1612af03478c16b2f65))
* **web:** inline first-paint splash logo, morph onto login ([1c2a71d](https://github.com/hoardodile/hoardodile/commit/1c2a71d6b52b1fc0c254da8ee6c9288920b2596d))
* **web:** memories strip reuses the pinned-section marquee ([92d5847](https://github.com/hoardodile/hoardodile/commit/92d584793c8d45ef03608768f290de354391f19d))
* **web:** plugin marketplace settings tab ([ef8898e](https://github.com/hoardodile/hoardodile/commit/ef8898eeb7bb566d24b800240b2555b169ce27ee))
* **web:** resilient doc diff and detail meta dates ([0558a44](https://github.com/hoardodile/hoardodile/commit/0558a4425ae33caaff5473a5f7718b27eb9a315b))
* **web:** show the thumb preview button on touch screens ([53a2848](https://github.com/hoardodile/hoardodile/commit/53a28480a422c39af09d4a50a3884e9091a4f8b7))
* **web:** Solar glyph icons for manifests and templates (three weights, lazy) ([b326d94](https://github.com/hoardodile/hoardodile/commit/b326d946d3cd2534bec7c9fa2f80c6b31973142e))

### Bug Fixes

* **ci:** don't trim inherited stdout in ensure-release-draft ([c004642](https://github.com/hoardodile/hoardodile/commit/c004642630472d158d66d3c26188c8d332e3776c))
* **ci:** report command errors in ensure-release-draft ([3225990](https://github.com/hoardodile/hoardodile/commit/3225990b86608c7c3a06b9ac7be6969199e112f3))
* **desktop:** clobber existing resource-pack assets on upload ([83137fc](https://github.com/hoardodile/hoardodile/commit/83137fc0f18501b0f945598918caed209b65579e))
* **host:** bump @hoardodile/7z-bin to 1.1.1 for Windows-safe extraction ([f5c759b](https://github.com/hoardodile/hoardodile/commit/f5c759b172f575f45df045a238eff159dfc2f74b))
* **host:** bump @hoardodile/7z-bin to 1.1.2 (pure-JS node-tar extraction) ([4d017c0](https://github.com/hoardodile/hoardodile/commit/4d017c0d359d4801b1025c882cfb5b0d38a21fc1))
* **root:** mark shipped bin launchers executable ([5f44845](https://github.com/hoardodile/hoardodile/commit/5f44845aae7ca584ae1dbd0bfd70c37a986d6de1))
* **root:** repair the release pipeline for v0.1.0 ([2e0daf1](https://github.com/hoardodile/hoardodile/commit/2e0daf1c91a91984b1ceb7c45aa49c2182e88176))
* **scripts:** import dirname in release.mjs ([b96e8ac](https://github.com/hoardodile/hoardodile/commit/b96e8ac53a99da700f169d489b417fdc74b3850d))
* **web:** pin prosemirror-changeset to 2.4.1 to restore document diffs ([540db5e](https://github.com/hoardodile/hoardodile/commit/540db5e960ef51ad15208e987c0f0ae8b94921d2))

## 0.1.0 (2026-08-25)

### Features

* **desktop:** add multi-size ico and dedicated tray icon ([74383c6](https://github.com/hoardodile/hoardodile/commit/74383c647277820d3f6b900a4709a4caf1a0d9d9))
* **desktop:** add opt-in local network sharing with configurable port ([11163c1](https://github.com/hoardodile/hoardodile/commit/11163c1542266190716a10d54f0bb404e1edef79))
* **desktop:** configurable close action with ask dialog ([26d654b](https://github.com/hoardodile/hoardodile/commit/26d654b87bd85e089dabc3e7acfabf6f86dd278a))
* **desktop:** LAN sharing UX and shell reliability polish ([c3ecb5c](https://github.com/hoardodile/hoardodile/commit/c3ecb5ce5837b3de7e3dfc2e8477438b0f9f7ecd))
* **desktop:** LAN sharing v2 — sign-in log, port precedence, weak-password gate, tray copy ([1a79500](https://github.com/hoardodile/hoardodile/commit/1a7950079017c58f1cc0ad13d6153bf251eddc84))
* **desktop:** linux/macOS packaging and packaged launch smoke ([3c8c481](https://github.com/hoardodile/hoardodile/commit/3c8c4818c91f6eb1bdfb2609e6f605ec4b27f3df))
* **desktop:** localize tray, dialogs and shell copy ([d989d9f](https://github.com/hoardodile/hoardodile/commit/d989d9f6a3bf6606f511845eac5daf7b111a454d))
* **desktop:** one-command dev loop with robust ports ([87782cb](https://github.com/hoardodile/hoardodile/commit/87782cb71b647905fcfc26c198d65c5ae288a214))
* **desktop:** resource-pack incremental update channel ([58367e9](https://github.com/hoardodile/hoardodile/commit/58367e911d43a23c8b3f778f0ad38c705091e8a3))
* **desktop:** seed every bundled official plugin and persist their uninstall ([f1df2a1](https://github.com/hoardodile/hoardodile/commit/f1df2a12de75a5de0a0b15c9aa210e1a00193965))
* **desktop:** share the close-confirm dialog with shell pages ([be485e5](https://github.com/hoardodile/hoardodile/commit/be485e5c45536588e5f0a8d48dd4f3b00962e537))
* **desktop:** unify the seed plugin channel (directory-driven build and runtime) ([46c9947](https://github.com/hoardodile/hoardodile/commit/46c99473aafa5167e037fce068c3e4d4d3bb1fc3))
* **host:** names-only zip listing for the legacy name truth ([e30f25b](https://github.com/hoardodile/hoardodile/commit/e30f25b850896646df241218e8f3823ecd177a34))
* **host:** sandbox plugin main.js in a permission-model child process ([357c163](https://github.com/hoardodile/hoardodile/commit/357c163a17fc8d42d6f4aa7bf262320fda3d6f2d))
* **i18n:** absorb the remaining wrapper components into @hoardodile/ui ([3b31efd](https://github.com/hoardodile/hoardodile/commit/3b31efd0abaf5aee5e3f57740b31cdec23b635ce))
* **i18n:** add Japanese, German and Spanish UI languages ([36e020e](https://github.com/hoardodile/hoardodile/commit/36e020e8156383dad611a0a74427e4e83d6bee27))
* **i18n:** localize the workbench chrome and align languageChanged payload with the wire ([11d936c](https://github.com/hoardodile/hoardodile/commit/11d936cfdacb975878dcf13f6a03d1ef01422818))
* **i18n:** unify translations on a published catalog package ([84ae7d5](https://github.com/hoardodile/hoardodile/commit/84ae7d59fb7401155d0a02a7e4e31f217fe680a0))
* **plugin-pdf:** add official PDF reader plugin ([9a5175f](https://github.com/hoardodile/hoardodile/commit/9a5175f30bae7eeb5e81d956ebd417431268d433))
* **plugin-pdf:** simplify viewer to fit-width only ([7a1471c](https://github.com/hoardodile/hoardodile/commit/7a1471c66521dd692d6a534a8f5e58f678f88aeb))
* **plugins:** user-consented asset downloads with shared consent dialog ([bb7ee23](https://github.com/hoardodile/hoardodile/commit/bb7ee23ce5c05146589467bfb280eed8a203bcfd))
* **server:** docker deployment with automated verification ([d3f659c](https://github.com/hoardodile/hoardodile/commit/d3f659c91782090dbe31e27d649c74c7c3397bdf))
* **web:** add Feedback & About sidebar entry and expand the About tab ([cd726e1](https://github.com/hoardodile/hoardodile/commit/cd726e15bad97ef472e4f9cf7b6a269791d465a0))
* **web:** enforce Content Security Policy on app shell pages ([4c0e949](https://github.com/hoardodile/hoardodile/commit/4c0e9493f808e6f6e812eaee0e73aa3bc2d9b195))
* **web:** hide the year in current-year full dates ([b319a00](https://github.com/hoardodile/hoardodile/commit/b319a0000490832a2e752cd29b3921e90e9878c5))
* **web:** localize hardcoded UI strings ([7ffffc9](https://github.com/hoardodile/hoardodile/commit/7ffffc909bfa954ecd31629a06d9a2d95823a26d))
* **web:** mark destructive plugin menu actions with the danger variant ([a139711](https://github.com/hoardodile/hoardodile/commit/a139711f2906172e7ac6232d19a6d378e0298726))
* **web:** move the global sidebar toggle into the desktop caption strip ([2236f58](https://github.com/hoardodile/hoardodile/commit/2236f589e45af75998c5ed93a39e9821ad6d4094))
* **web:** polish plugin settings UI (badges, More menu, uninstall confirm) ([3a40b6b](https://github.com/hoardodile/hoardodile/commit/3a40b6b82641ad4a87c2afcd5472275a42fd3d5e))
* **web:** route bug report to the platform-specific issue template ([a12700a](https://github.com/hoardodile/hoardodile/commit/a12700a48e50c69af2a0df2c3dbb57761e365119))
* **web:** split App settings tab into Data/About/Desktop; add shell cache cleanup ([cda3a50](https://github.com/hoardodile/hoardodile/commit/cda3a505c25f2119279108c8f3080150d2bc90d0))
* **web:** type i18n keys and pin plural config ([a7e3562](https://github.com/hoardodile/hoardodile/commit/a7e3562af463b06314c61600bad5752c9ed641d1))
* **web:** use the package.json description in About and icon the feedback buttons ([c5598d1](https://github.com/hoardodile/hoardodile/commit/c5598d12208f7fcf530f829d45b08b63bcd1f146))
* **workbench:** rebuild the dev workbench on @hoardodile/ui ([6fb02e0](https://github.com/hoardodile/hoardodile/commit/6fb02e075cb51a18609fe004c3dee452b41757d1))

### Bug Fixes

* **cli:** bundle the SDK closure into plugin server bundles ([722ebad](https://github.com/hoardodile/hoardodile/commit/722ebad5570b646f2fc69d2f13ed214aeea3c9b8))
* **desktop:** cap proxy, tRPC and auth-status requests at 15s ([8d1ae66](https://github.com/hoardodile/hoardodile/commit/8d1ae6674db1b0bd411930bb016158092f9a069e))
* **desktop:** decouple desktop dev loop from the web SPA ([c99c7d4](https://github.com/hoardodile/hoardodile/commit/c99c7d481072469e5e0ae4d9fd76ee29ba05378b))
* **desktop:** dev loop launches without pnpm dev — window shows its retry page ([f8a0d7d](https://github.com/hoardodile/hoardodile/commit/f8a0d7d8773a3b55c0a242a1772e452729cbdf45))
* **desktop:** keep non-SPA links out of the app window ([edd7de6](https://github.com/hoardodile/hoardodile/commit/edd7de652bdfac0311b7ef8a414549aab642bb5d))
* **desktop:** keep sidecar native deps in packaged server resources ([7569349](https://github.com/hoardodile/hoardodile/commit/7569349307a7cb24d47b8dea36e7a876ded8b7a4))
* **desktop:** make the updater cache dir formula test portable ([867a7fb](https://github.com/hoardodile/hoardodile/commit/867a7fb6fee8c9682189a5ce7a65706643e75eb1))
* **desktop:** resolve updater cache dir with win32 join ([1aeb2b3](https://github.com/hoardodile/hoardodile/commit/1aeb2b3a3889819647a218dea4ff0f163ce985b7))
* **desktop:** unify loading spinner and wire the restore caption button ([6ad4e1e](https://github.com/hoardodile/hoardodile/commit/6ad4e1ee4216463be3ba7867d5a0e91df7d089b6))
* **desktop:** widen devtools dock reservation in dev ([730a670](https://github.com/hoardodile/hoardodile/commit/730a6700d4fa821ee250a5fc84ed03bffd4de937))
* **dev:** ignore atomic-save temp artifacts in dev watchers ([66f4a65](https://github.com/hoardodile/hoardodile/commit/66f4a653234a352e713de635915c3791a1e5782c))
* **host:** apply legacy-name renames in the container extract API ([1b86c48](https://github.com/hoardodile/hoardodile/commit/1b86c48fa7a9371ab3299eed704c9faf0ea72b66))
* **host:** canonicalize sandbox paths before granting fs-read ([0cec248](https://github.com/hoardodile/hoardodile/commit/0cec24885e6afac8706534913640f1d5467fd5f5))
* **host:** encode sandbox gate URLs with pathToFileURL ([b654318](https://github.com/hoardodile/hoardodile/commit/b654318a2d5424fb3b5ec51f70346bce5886724f))
* **host:** include allowed prefixes in sandbox denial errors ([2cb3bf9](https://github.com/hoardodile/hoardodile/commit/2cb3bf9dfef33bd2592cab6146ef4aa295bd7bbf))
* **host:** rename macOS %XX-escaped legacy zip entry names ([b6a3480](https://github.com/hoardodile/hoardodile/commit/b6a34808743b10e258ab5c6a22aa9c30b366881f))
* **host:** source legacy zip names from the archive itself ([70b94ee](https://github.com/hoardodile/hoardodile/commit/70b94ee08b5dcce5f7aa2005734f0f80dd6f4eb4))
* make lint fail on useTemplate violations and fix them ([53eb983](https://github.com/hoardodile/hoardodile/commit/53eb98355fbee8560c9aa749d174022226cb2a71))
* **plugin-pdf:** fix multi-page testdata and add open-source samples ([8d9f4f4](https://github.com/hoardodile/hoardodile/commit/8d9f4f4fae2d718a337e4d7fc7ebbd2d0896172a))
* **root:** keep release version sync output biome-canonical ([abccac5](https://github.com/hoardodile/hoardodile/commit/abccac50b60b3e030ee81125452f94916574413d))
* **server:** close keep-alive sockets on shutdown ([9ff3b27](https://github.com/hoardodile/hoardodile/commit/9ff3b27bdb536b9914bb722e3ad584307854607d))
* **server:** make image-search sweep test clock deterministic ([a3aaf97](https://github.com/hoardodile/hoardodile/commit/a3aaf97c76ca9c35be6cead27868e5b510a5beb7))
* **shared:** add periods to hint descriptions ([d5f394b](https://github.com/hoardodile/hoardodile/commit/d5f394bb8fc7a6367cfcefd0ad8176b0b484951b))
* **shared:** correct singular plural phrasing and document counts ([db0557e](https://github.com/hoardodile/hoardodile/commit/db0557e34d220d472aceaf4cf833cfb32536e9d6))
* **shared:** replace legacy plural keys and fix count labels ([d57a509](https://github.com/hoardodile/hoardodile/commit/d57a5092fbdd4a0e6b059f7ebcb6f99fab20d888))
* **shared:** space zh document index description ([af2e130](https://github.com/hoardodile/hoardodile/commit/af2e13092db078f04e3708cf34fcde4f2dc606c5))
* **shared:** unify ellipsis and dash punctuation ([b06164d](https://github.com/hoardodile/hoardodile/commit/b06164d9cdd663ef1e111830f305941e505bd6c0))
* **shared:** unify empty-state copy (No X yet. / 暂无X。) ([7f029e8](https://github.com/hoardodile/hoardodile/commit/7f029e8f9593caa472d0857f4ff00c364c4c4204))
* **shared:** unify error phrasing (Could not vs Failed to) ([d9696c0](https://github.com/hoardodile/hoardodile/commit/d9696c05cc3e047fc2505bf8ef3fa4cb0542510a))
* **ui:** pointer cursor on switch and mobile bottom padding ([73b5e0d](https://github.com/hoardodile/hoardodile/commit/73b5e0d70c9e5660917d8fab2ac8974dac957982))
* **ui:** restore top padding on page scaffold frames ([9173df9](https://github.com/hoardodile/hoardodile/commit/9173df9c4cea75d348b433221f0a1f491976a37f))
* **web:** adapt date and usage tests to dayjs timezone rework ([a3e8b86](https://github.com/hoardodile/hoardodile/commit/a3e8b86aac1a56cc5d2f3765f57fa6b8287f6d24))
* **web:** align thumbnails e2e with resource-name empty tile ([4a32a06](https://github.com/hoardodile/hoardodile/commit/4a32a06cdcf322376ffabbc201c99d6af5be4901))
* **web:** drop hover transitions on sidebar nav and documents tree rows ([1c0bb1a](https://github.com/hoardodile/hoardodile/commit/1c0bb1acf696b93f15812c34e561f14da449cf3d))
* **web:** graceful documents page states and tree row spacing ([d53e4bf](https://github.com/hoardodile/hoardodile/commit/d53e4bfb4bf5a1c8f7580e5f386e7a04a705620c))
* **web:** keep long pages on a single scroll surface ([b79f7fa](https://github.com/hoardodile/hoardodile/commit/b79f7fa460799230d679f7b9630dcb9cda439be9))
* **web:** restore route scroll positions after late-growing content ([5772be0](https://github.com/hoardodile/hoardodile/commit/5772be0b34f1afcc026468abb6b0be00535feaef))
* **web:** show full dates in the recent connections log ([daee802](https://github.com/hoardodile/hoardodile/commit/daee802592f8860eeae8850baf380f3d8b39e6e8))
