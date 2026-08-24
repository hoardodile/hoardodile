# @hoardodile/sdk-react

React bindings for hoardodile content plugin iframes. Framework-agnostic
plugins use `@hoardodile/sdk-web` directly instead.

## Install

```bash
pnpm add @hoardodile/sdk-react
```

## What's in it

- **`createPluginRoot(config)`** — one-call bootstrap: mounts the iframe
  bridge, wires the typed `PluginAPIProvider`, applies host theme/fonts,
  and remounts on resource rebind
- **`definePluginAPI<Schema>({ decodeAnchor })`** — declare your plugin
  schema once and get a typed `PluginAPIProvider`, `usePluginAPI` and
  `useAnchorJump`
- **`useVisibility()`** — pause media/timers when the iframe is parked
- **`useCacheWriter()`** — debounced per-resource cache writes with a
  flush on `pagehide`/unmount
- **`createPluginTranslation(bundles)`** — `useTranslation()` backed by
  the shared `@hoardodile/i18n` catalogs and the host's language pushes;
  `@hoardodile/ui` chrome is localized for free in every supported host
  language. Want full control over the i18n stack (namespaces, plurals,
  `Trans`, custom format, lazy backends)? Assemble your own
  react-i18next instance instead — the only hoardodile piece is the
  `languageChanged` notification from `@hoardodile/sdk-web` (see the
  advanced pattern in `skills/hd-plugin/references/client.md`).
- **`StubPluginAPIProvider`** — render-test fixture

## Quick start

```tsx
// src/render.tsx
import { createPluginRoot, definePluginAPI } from "@hoardodile/sdk-react"
import type { PluginSchema } from "@hoardodile/sdk-types"

interface MySchema extends PluginSchema {
	file: { filename: string }
	sourceMeta: { files: readonly { filename: string }[] }
}

const { PluginAPIProvider, usePluginAPI } = definePluginAPI<MySchema>()

function Viewer() {
	const api = usePluginAPI()
	const { data: files } = api.useFileList()
	return <div>{files?.length} files</div>
}

createPluginRoot({ render: Viewer, provider: PluginAPIProvider })
```

## Where does the code live?

The imperative API surface (`WebPluginAPI`) and the wire protocol live in
`@hoardodile/sdk-web`; this package composes them into the reactive API
React components see. Shared message/danmaku/anchor types come from
`@hoardodile/sdk-types`.
