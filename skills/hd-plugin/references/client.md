# Client Side — Iframe Runtime and `@hoardodile/sdk-react`

The viewer is a sandboxed iframe. It talks to the browser-side host over
`postMessage` against the versioned wire protocol
(`PROTOCOL_VERSION` — plugins stamp every outbound message; the host
warns loudly on a mismatch). Because a null-origin iframe cannot send
SameSite cookies, a short-lived `fileToken` from the context makes
resource-file URLs work inside the iframe.

Plugin authors use `@hoardodile/sdk-react` when on React (the normal
case); drop to `@hoardodile/sdk-web` for framework-agnostic parts.

## Bootstrap

`src/shared.ts` — the schema; `src/hooks.ts` — the typed API pair,
declared once at module level:

```ts
import { definePluginAPI } from "@hoardodile/sdk-react"
import type { MySchema } from "./shared"

export const { PluginAPIProvider, usePluginAPI, useAnchorJump } =
  definePluginAPI<MySchema>({ decodeAnchor })
```

`src/render.tsx` — mount:

```ts
import { createPluginRoot } from "@hoardodile/sdk-react"
import { PluginAPIProvider } from "./hooks"
import { MyView } from "./MyView"

createPluginRoot({ provider: PluginAPIProvider, render: MyView })
```

`definePluginAPI` options: `decodeAnchor(data)` validates the host's
incoming `anchorJump` payload against the schema's `anchor` slot —
anchors that fail are dropped and never reach the callback. Declare it
whenever the schema declares an `anchor` type. The provider returned
shares the runtime context with `createPluginRoot`, so typed consumers
work without repeats.

## The API

`usePluginAPI()` returns the imperative surface plus hooks:

**Imperative (`WebPluginAPI`)** — logging (`logInfo/…`), `resource`
(the bound `PluginResource`), `listFiles()`, `readFile(path, range?)`
(`ArrayBuffer`), URL resolvers:

- `resolveFileUrl(filename, variant?)` — `"original"` (default),
  `"preview"` (host-rendered AVIF variant), or an `ImageVariantSpec`
  like `{ format: "webp", fit: "exact" }` / `{ maxArea: 2_000_000 }`;
  variants are cached by the host — use the file's `preview` flag to
  gate an original/preview toggle.
- `resolveExtractedUrl(path)` — an inner entry materialized by
  `extractArchive`.
- `extractProgressUrl()` — in-flight extraction progress (`{done,total}`
  or `null`; cheap no-store polls).
- `resolveBaseUrl()` — the resource files directory root (for vendor
  SDKs joining relative paths).
- `resolveFrameUrl(filename, timeMs)` — frame thumbnail at a timestamp;
  debounce scrubbing — each call decodes a frame.

Messages/danmaku (require manifest permissions): `listMessages()`,
`createMessage({ body, anchor? })`, `listDanmaku(filter?)`,
`createDanmaku({ text, anchor, mode? })`. Prefs/cache: `getPref/setPref`,
`getCache/setCache/listCache`, `invalidate(target)` for
`"resource" | "resources" | "messages" | "danmaku"`. Anchor jumps from
the host arrive via `onAnchorJump(cb)`.

**Reactive hooks (`ReactivePluginAPI`, from `createPluginQueryAPI`)** —
`useFileList()`, `useMessageList()`, `useCreateMessage()`,
`useDanmakuList(filter?)`, `useCreateDanmaku()`,
`usePref(key, defaultValue, codec?)`, `useTheme()`, `useFont()`.
Query/mutation results have the shape
`{ data, isLoading, isError, error }`.

Also in `@hoardodile/sdk-react`: `createPluginTranslation()` (returns
`{ t(key, vars?), language }` — flattened bundle, `{{var}}`
interpolation, picks the `language` from the iframe context),
`useCacheWriter`, `useExtractProgress`, `useVisibility`.

## Iframe context and pushes

The host injects `window.__context__` and pushes replacements — a pooled
iframe is rebound across resources without a reload, and every push
re-invokes the mount callback. Handle context as data, not as a
one-shot flag.

| Context field | Meaning |
| --- | --- |
| `pluginId`, `resId`, `resName`, `contentPluginId` | Identity and binding. |
| `sourceMeta`, `searchMeta`, `fileStats` | Current resource payloads (the file list comes via `listFiles`). |
| `language` | UI language for your locale bundle. |
| `resolvedTheme` | `"light" \| "dark"` — set your document class accordingly. |
| `palette` | `"mono" \| "sage" \| "parchment" \| "azure" \| "hoardodile"` — the SDK's `applyTheme` puts `.theme-<palette>` on the document (skipped for `mono`, which lives unclassed in `:root`/`.dark`), so `@hoardodile/ui/theme.css` palettes apply. |
| `iconStyle` | `"duotone" \| "grayscale" \| "linear"`; the SDK's `applyTheme` sets `data-icon-style` on the document, and theme.css carries the rules. |
| `fonts` | The host font family + preset stylesheet paths, unless `ui.inheritFont: false`. `applyFonts`/`applyTheme` in `@hoardodile/sdk-web` wire it — `createPluginRoot` calls them for you; bare sdk-web consumers call them from the push subscribers. |
| `initialPrefs`, `initialCache` | Plugin-scoped prefs/cache seeded from the server. |
| `fileToken` | Short-lived token for resource-file URLs. |

Host pushes (keys from `@hoardodile/sdk-web`'s `hostPushKeys`):
`context`, `visibility`, `themeChanged`, `fontsChanged`,
`languageChanged`, `prefsChanged`, `cacheChanged`, `anchorJump`,
`res:invalidate`, `resources:invalidate`, `messages:invalidate`,
`danmaku:invalidate`. Framework-agnostic code uses `mountPlugin` (wire
the bridge + context), `applyTheme`, `applyFonts`,
`subscribeToVisibility`, `getPluginContext`, `ensureHostBridge`, and
the `codecs` (`booleanCodec`, `jsonCodec`, `numberCodec` — for `usePref`
typed reads). `createIframeHostAPI` is the runtime used by the mount
wrapper.

## Anchors and messages

- The wire envelope is `AnchorData` = `{ data?: unknown }` (strict): the
  host injects the resource id, plugins never see one, and a plugin that
  sends one is rejected. Work with the schema's bare `anchor` type.
- Messages: `Message` with `body` + optional anchor; the host renders
  the anchor via `ui.message.anchor` templates (e.g.
  `{{duration(data.timeMs)}}`).
- Danmaku: `Danmaku` with `text`, `anchor`, `mode` (filters by
  `DanmakuListFilter`).
- Types come from `@hoardodile/sdk-types` (re-exported by `sdk-web`);
  the runtime zod schemas live in the `@hoardodile/sdk-types/schema`
  subpath — only import that where a runtime validator is actually
  needed (the host side); plugin bundles never pull zod.

## Testing the client

- `createWebPluginAPI` / `StubPluginAPIProvider` /
  `createPluginQueryAPI` make the full API available in jsdom/Vitest
  without a host — stub `resolveFileUrl`, `readFile`, stores and
  subscriptions as your test needs.
- Keep protocol drift visible: any test asserting exact push/method
  names belongs in a suite that imports `hostPushKeys` /
  `pluginMethods` from `@hoardodile/sdk-web` so a contract change fails
  loudly.
