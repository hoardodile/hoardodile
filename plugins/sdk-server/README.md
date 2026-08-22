# @hoardodile/sdk-server

The authoring surface for hoardodile content plugin `main.js` files — the
**only** package you need on the server side of a plugin.

## Install

```bash
pnpm add @hoardodile/sdk-server
```

## What's in it

- **`definePlugin()`** — declarative plugin definition with runtime shape
  validation (unknown hooks and synchronous hooks are rejected at load
  time, not at hook time)
- **Composable detectors** — `hasKind`, `hasMime`, `hasExt`, `hasName`,
  `minFiles`, `all`, `any`, `not`, `files`
- **`ResourceAPI`** — the typed, resource-scoped API every hook receives
  (`listFiles`, `readFile`, `statFile`, `statFiles`, `sniff`, `probe`,
  `hashBytes`, `computeImageHashes`, scoped logging)
- **Fixtures** — `createResourceAPIFixture`, `stubLogger` for unit tests

## Quick start

```ts
// src/main.ts
import { any, definePlugin, hasKind } from "@hoardodile/sdk-server"
import { probeMediaFile } from "@hoardodile/sdk-server/helpers"

export default definePlugin({
	// Content decides, so mislabelled and extension-less files still match.
	detect: any(hasKind("image"), hasKind("video")),
	sourceMeta: async (api) => {
		const files = await api.listFileNames()
		return {
			files,
			previews: await Promise.all(files.map((f) => probeMediaFile(api, f))),
		}
	},
})
```

## Subpaths

| Entry | Contents |
| ----- | -------- |
| `@hoardodile/sdk-server` | The authoring surface (root) |
| `@hoardodile/sdk-server/helpers` | Probe/file helpers: `extname`, `mapConcurrent`, `naturalSort`, `probeMediaFile`, `probeImageFile`, `probeVideoFile`, `probeAudioFile`, `readFileChunks` |

## Where does the code live?

`definePlugin`, `ResourceAPI`, the fixtures and the hook-name contract
are implemented in `@hoardodile/sdk-types` and re-exported here so
plugin authors have a single import root. This package is
dependency-closed within the SDK — it never imports `@hoardodile/host`.
Dev-time test tooling (`runPluginHook`, `createDirectoryResourceAPI`) is
available from `@hoardodile/host` as a **devDependency** (never bundled
into the shipped plugin): it runs hooks against a real directory for
Layer-2 tests.

## Licensing

MIT. The plugin contract, the SDK packages and the plugin code you write
are all permissive — a plugin built with this SDK is an independent
work and can be released under any license (MIT, GPL, proprietary, or
none at all).

## Docs

- [Plugin development](https://docs.hoardodile.com/plugin-development/) —
  anatomy, hooks, the dev loop
- [Plugins overview](https://docs.hoardodile.com/plugins/)
- [Getting started](https://docs.hoardodile.com/getting-started/)
