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
  gate an original/preview toggle. To address an entry inside an
  archive, pass the `outer!inner` form (e.g. `book.cbz!Ch1/001.jpg`);
  the host serves zip entries from the archive's central directory and
  tar/7z/rar entries from the extraction cache once `extractArchive`
  has run. This is the **single** resolver for literal files and archive
  entries alike.
- `extractProgressUrl()` — in-flight extraction progress (`{done,total}`
  or `null`; cheap no-store polls).
- `resolveBaseUrl()` — the resource files directory root (for vendor
  SDKs joining relative paths).
- `resolveFrameUrl(filename, timeMs)` — frame thumbnail at a timestamp;
  debounce scrubbing — each call decodes a frame.

- `uploadCover({ file, filename, mimeType? })` — set the **permanent
  cover** of the resource this plugin is bound to (the client counterpart
  of the `coverLocal` hook, which only *resolves a path inside the
  resource*). `file` is raw image bytes (`Blob`/`ArrayBuffer`); the cover
  type is derived **server-side from `filename`'s extension** — the real
  host always sends the body as `application/octet-stream`, so a
  `mimeType` is accepted but never authoritative (name the file
  `.png`/`.jpg`/`.webp`/…). The host performs the credentialed
  `PUT /api/resources/:id/cover` on the plugin's behalf (the sandboxed
  iframe has no session cookie), automatically scoped to the resource
  you're bound to, then invalidates the resource caches so cover
  tiles/cards refresh. Resolves to `{ path }`; a failed upload rejects.

Messages/danmaku (require manifest permissions): `listMessages()`,
`createMessage({ body, anchor? })`, `listDanmaku(filter?)`,
`createDanmaku({ text, anchor, mode? })`. Prefs/cache: `getPref/setPref`,
`getCache/setCache/listCache`, `invalidate(target)` for
`"resource" | "resources" | "messages" | "danmaku"`. Anchor jumps from
the host arrive via `onAnchorJump(cb)`. For quick dev iteration, the
workbench's **Configure → Plugin state** resets your prefs and clears the
current resource's cache (`Reset settings` / `Clear cache`, restored from
the library via `Restore`) — see `tooling.md`.

**Reactive hooks (`ReactivePluginAPI`, from `createPluginQueryAPI`)** —
`useFileList()`, `useMessageList()`, `useCreateMessage()`,
`useDanmakuList(filter?)`, `useCreateDanmaku()`,
`usePref(key, defaultValue, codec?)`, `useTheme()`, `useFont()`.
Query/mutation results have the shape
`{ data, isLoading, isError, error }`.

Also in `@hoardodile/sdk-react`: `createPluginTranslation(bundles)` —
returns `{ useTranslation }`, and the hook returns `{ t(key, vars?),
language }` (`{{var}}` interpolation + plurals via i18next, initial
language from the iframe context, re-resolved on `languageChanged`).
Your bundle covers your own strings only (missing languages fall back to
English); `@hoardodile/ui` component chrome is translated separately from
the shared `@hoardodile/i18n` `ui` catalog in every host language:

```ts
const { useTranslation } = createPluginTranslation({ en: {…}, zh: {…} })
// in a component:
const { t } = useTranslation()
```

### Advanced i18n — assemble react-i18next yourself

The official wrapper is a convenience, not a straitjacket. For full
control (custom namespaces, plurals/ordinals, `<Trans>`, custom
`interpolation.format`, lazy-loaded catalogs, i18next-parser extraction)
assemble your own instance. The only hoardodile dependency is the host
**language notification** — the initial value from the plugin context and
the `languageChanged` push; everything else is plain `i18next` +
`react-i18next`:

```ts
// src/i18n.ts — apart from the host language notification, no @hoardodile package
import i18next from "i18next"
import { initReactI18next, useTranslation } from "react-i18next"
import { ensureHostBridge, getPluginContext } from "@hoardodile/sdk-web"

const AVAILABLE = ["en", "zh"] // your bundle's languages
function normalize(raw: string | undefined): string {
  const base = raw?.toLowerCase().split("-")[0]
  return base !== undefined && (AVAILABLE as string[]).includes(base) ? base : "en"
}

export const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { /* …, plus `_one`/`_other` plural pairs */ } },
    zh: { translation: { /* … */ } },
  },
  lng: normalize(getPluginContext()?.language ?? navigator.language),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  // Everything else is wide open here: keyPrefix, pluralSeparator,
  // interpolation.format, Trans components, async backends, extraction…
})

// The wire payload is a bare language-code string (see HostPushes table).
ensureHostBridge().subscribe("languageChanged", (language) => {
  void i18n.changeLanguage(normalize(language))
})

export { useTranslation }
```

Trade-offs: with the wrapper you get zero-config ui chrome localization
and English fallback for free; a hand-rolled instance only owns your own
strings — if you keep `@hoardodile/ui` components with chrome copy, load
the `ui` namespace (optionally from `@hoardodile/i18n/catalogs/ui`) and
subscribe the same way.

Plus `useCacheWriter`, `useExtractProgress`, `useVisibility`.

### `usePref` — encode before you compare

Prefs are **string** end to end. Without a codec the SDK serializes with
`String(value)`:

- **Never store `null` in a codec-less pref** — it round-trips as the
  literal string `"null"` and `=== null` never matches. Use a string
  sentinel (`"custom"`) for discrete modes;
- codecs are **factories**: `numberCodec()`, `booleanCodec()`,
  `jsonCodec()` — call them, don't pass them;
- the setter is `(value: T) => void` — **no functional updates**
  (`setPref(v => …)` does not exist); compute from the current value.

This class of bug is silent: the value persists, the comparison just
never fires.

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
| `assetToken` | Short-lived token for the plugin's **own vault** URLs (`resolveAssetUrl`); `""` when the manifest lacks the `download` permission. |

## Plugin asset vault (client side)

The same user-consented downloads as `main.js` — one server pipeline,
one dialog:

- `download({ url, dest, sha256?, reason? }): Promise<{ path, sizeBytes, sha256, cached }>`
  or `download([…]): Promise<readonly { path, sizeBytes, sha256, cached }[]>`
  — pass an **array of requests** to fetch several files under ONE
  consent question: one dialog lists every item (URLs verbatim), the
  batch is all-or-nothing (any failure discards all staged files and
  rejects with the first error), results arrive in request order, and
  the cap is 16 items per call. Cached destinations resolve with **no
  dialog and no network**; otherwise the web app asks ("remember for
  this session" skips further prompts). Rejections carry `err.name`:
  `DENIED` / `UNAVAILABLE` / `POLICY`. Gated by the manifest `download`
  permission.
- `resolveAssetUrl(path)` — URL of a vault file (JS served with an exact
  MIME + `nosniff`; only HTML is demoted to an attachment). Load a
  runtime with `<script src={api.resolveAssetUrl("runtime/live2d.min.js")} />`
  (classic scripts need no CORS), a module import, or `fetch`→Blob for
  something else; `Cache-Control: private, no-cache` so re-downloads are
  never served stale.
- `deleteAsset(path)` — idempotent vault removal (the plugin decides its
  own lifecycle; no consent, nothing leaves the host).
- The vault lives at `<plugin-dir>/vault/` (synced, snapshotted,
  deleted on uninstall, kept across updates) and `vault/` in a zip is
  rejected at install. The offline mock host, the workbench and
  read-only archive mode answer `UNAVAILABLE`.

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

## Sandbox and CSP reality

Plugin pages are served with
`sandbox allow-scripts allow-forms allow-downloads` (host-side CSP,
mirrored on the iframe). Consequences:

- **Opaque origin**: all requests are cross-origin (the host answers
  with `access-control-allow-origin: *`), and no cookies — resource
  URLs carry a short-lived `fileToken` instead.
- **No popups, no top navigation**: `window.open`, `target="_blank"`
  and anchor navigation out of the iframe do nothing. Downloads work
  through the sandbox's `allow-downloads`: render a plain `<a href={url}
  download>`.
- **Workers are allowed** (no `worker-src` restriction) — but a worker
  script URL from a sandboxed document is often rejected by the
  same-origin check (document origin is "null"), so `new Worker(...)`
  on a plain asset URL may throw; the blob fallback below covers it.

## Large files

Prefer the URL path over whole-file reads:

- `resolveFileUrl(filename)` points at the host's Range-capable file
  server (`accept-ranges: bytes`, ETag/If-Range, CORS `*`) — libraries
  with range transport (e.g. pdf.js `getDocument({ url })`) stream
  progressively and never hold the whole file in memory.
- Fall back to `readFile()` (full bytes) only for small files, guarded
  by size (e.g. ≤ 96 MB); above that, surface the streaming error
  instead of loading a giant buffer into the sandbox.

## Workers and bundled assets

- Import worker scripts as asset URLs:
  `import w from "pkg/build/worker.min.mjs?url"`, then
  `new Worker(new URL(w, import.meta.url).href, { type: "module" })`.
- If worker construction throws under the opaque origin, re-serve the
  same bytes as a blob URL (`fetch(url) → blob → URL.createObjectURL`)
  — blob workers are allowed in sandboxed documents. Libraries like
  pdf.js additionally fall back to a main-thread "fake worker"
  automatically.
- Verify the worker actually loads in the workbench before shipping;
  some engines reject URL workers in sandboxed frames even when the CSP
  permits them.

## Never swallow render errors

A failed canvas/decoder render must not look like loading. Keep a
per-surface error state: show a small error placeholder and
`console.warn` the cause, instead of leaving the loading spinner up
forever.

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
