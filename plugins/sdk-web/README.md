# @hoardodile/sdk-web

Pure-browser iframe runtime for hoardodile content plugins: the wire
protocol (single source of truth, versioned via `PROTOCOL_VERSION`), host
bridge, stores, and theme/font/visibility helpers. No node code — the
d.ts surface is guarded against node references in CI.

Use `@hoardodile/sdk-react` when you build with React; drop to this
package for framework-agnostic iframe code.

## Install

```bash
pnpm add @hoardodile/sdk-web
```

## What's in it

- **`createIframeHostAPI(ctx)`** — the imperative, framework-agnostic
  `WebPluginAPI`: files, messages, danmaku, prefs, cache, invalidation,
  anchor-jump subscription
- **`mountPlugin(mount)`** — host→plugin communication with a pooled
  iframe lifecycle (rebind without reload)
- **`createWebPluginAPI(overrides)`** — a stubbed API for render tests
- **`jsonCodec` / `numberCodec` / `booleanCodec`** — typed pref codecs
- **`applyTheme` / `applyFonts`** — host theme and font inheritance
- **`ensureHostBridge`** — low-level postMessage bridge (rarely needed)

## Quick start

```ts
import { mountPlugin, createIframeHostAPI } from "@hoardodile/sdk-web"

mountPlugin((ctx) => {
	const api = createIframeHostAPI(ctx)
	api.listFiles().then((files) => {
		document.querySelector("#root")!.textContent = files.join(", ")
	})
})
```

## Where does the code live?

The wire protocol is the contract, defined once in `@hoardodile/sdk-types`
and re-exported here for a single import root. The browser-side *host*
runtime (`@hoardodile/host-web`) consumes this protocol — it never
redefines it.

## Docs

- [Plugin development](https://docs.hoardodile.com/plugin-development/)
- [Plugins overview](https://docs.hoardodile.com/plugins/)
