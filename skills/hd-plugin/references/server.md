# Server Side — `definePlugin` and `ResourceAPI`

The server part of a plugin is a single module (bundled to
`dist/main.js`) exporting the default result of `definePlugin()` from
`@hoardodile/sdk-server`. All hook functions live here; the host calls
them with a `ResourceAPI` and never invokes a factory.

**Capability sandbox.** The bundle runs in a dedicated restricted child
process: Node's permission model (fs reads limited to the plugin's own
directory, no write/child-process/native-addon grants) plus a module
policy hook that denies every `node:` builtin except `node:url` and
anything outside the plugin dir — and a scrubbed global surface
(`fetch`/`WebSocket` throw, `process.env` is empty). The only privileged
interface is the `ResourceAPI` RPC; per-hook budgets bound log messages
(1000) and API calls (100k). `listContainer`/`extractArchive` need
`"container": true` in the manifest, enforced host-side.

```ts
import { definePlugin } from "@hoardodile/sdk-server"
import type { MySchema } from "./shared"

export default definePlugin<MySchema>({
  detect: async (api) => { … },          // required
  sourceMeta: async (api) => { … },      // optional
  searchMeta: async (api) => { … },
  coverLocal: async (api) => { … },
  listFiles: async (api) => { … },
  imageHashes: async (api) => { … },
})
```

## The one shared schema

Declare `PluginSchema` once (`src/shared.ts`) and use it as the generic
on both sides — server (`definePlugin<MySchema>`) and client
(`definePluginAPI<MySchema>()`). Slots: `file`, `sourceMeta`,
`searchMeta`, `detect` (the match payload, see below), `anchor`
(location data carried inside messages/danmaku envelopes). The schema
types the injected context too, so a payload that drifts from the schema
fails to build.

## Hook contract

- **Only six hook names exist** and `definePlugin` validates the shape at
  load time: unknown keys and missing `detect` fail with a friendly
  message; every hook must be an `async` function.
- **`detect` (required)** — answers "does this resource belong to this
  plugin?" with the shared result vocabulary:
  - match: `{ ok: true, …payload }` (or `ok({ … })`);
  - miss: `{ ok: false, reasons: ["…"] }` (or `err({ reasons })`).
  The payload is stored and exposed to the other hooks as
  `api.context.detect` — **classify once, never rescan**.
- **`sourceMeta`** — metadata shown in cards and the detail view
  (`{{source.*}}` in manifest templates). Return the schema's
  `sourceMeta` shape or `undefined`.
- **`searchMeta`** — indexed, searchable metadata. Keep it lean: what
  search needs, nothing cosmetic.
- **`coverLocal`** — resolve a local cover source (`string | undefined`):
  a path inside the resource that should render as the cover.
- **`listFiles`** — the typed file list sent to the iframe. Results are
  cached verbatim in a sidecar; absent → the host sends a bare list of
  source filenames.
- **`imageHashes`** — content hashes for duplicate detection and image
  similarity, via the API primitives (`hashBytes`,
  `computeImageHashes`). Absent or failing keeps hash rows empty;
  request only the kinds you need.

`api.context.detect` may be `undefined` on a fresh worker — every hook
must handle the absent case by re-deriving.

## ResourceAPI

Every method is resource-relative; the host resolves absolute paths.
Container addressing `outer!inner` reads inside a zip/tar entry
(`book.cbz!Chapter 1/001.jpg`).

| Method | Purpose |
| --- | --- |
| `listFileNames()` | Flat canonical file-name list (upload `.order` if present, else natural sort). |
| `readFile(path, range?)` | Read bytes; pass a range (or `readFileChunks` from `@hoardodile/sdk-server/helpers`) for large files — hosts may reject oversized full reads. |
| `statFile(path)` / `statFiles(paths)` | Byte size without reading; batch form is one host round-trip (positions preserved). |
| `sniff(path)` | Cheap identification: magic bytes, extension fallback. Never decodes — use it to route work. |
| `probe(path)` | One-pass metadata decode (sharp images, ffprobe audio/video; settles ambiguous containers). **Never rejects**: `{ kind: "other" }` = identified non-media; `{ kind: "unknown", reason: "unsupported" \| "unavailable" \| "failed" }` distinguishes no-backend from decode failure. |
| `hashBytes(path, "md5" \| "sha256")` | Stream hash, safe for arbitrarily large files. |
| `computeImageHashes(path, kinds)` | `sha256`/`dhash`/`phash` in one pass (animated → first frame); `undefined` when not a decodable image. |
| `listContainer(filename)` | Container (zip/tar) listing without materializing — cheap. |
| `extractArchive(filename)` | Materialize a container into the host's extraction cache so the browser can serve inner files over URLs. Idempotent (re-lists from the manifest), budget-checked, rejects when unsupported; writes `local/cache`, writable in every view mode. |
| `download({ url, dest, sha256?, reason? })` | **User-consented download into the plugin's own vault** (`versions/<v>/plugins/<id>/vault/`): if `dest` already exists the host answers `cached: true` (no dialog, no network); otherwise the web app asks the user (URL shown verbatim) and fetches on approval. Rejections carry `err.name`: `DENIED` (declined/timeout), `UNAVAILABLE` (no client attached, read-only archive, CLI/workbench), `POLICY` (no `download` permission, URL/dest not allowed, hash mismatch). Optional `sha256` pins the bytes (SRI-style); `reason` is shown in the dialog. Gated by the manifest `download` permission. |
| `statAsset(path)` / `readAsset(path)` | Inspect/read a vault file (byte-size check, bounded read). Same permission gate; `statAsset` is the cheap presence check. |
| `deleteAsset(path)` | Remove a vault file — the plugin decides the vault's lifecycle (e.g. stale layouts after an update). Idempotent (`{ existed: false }`), no consent needed, nothing leaves the host. |
| `context` | `{ detect }` — the last successful match payload. |
| `logInfo(logWarn / logError)` | Plugin-scoped structured logging. |

### The vault (downloaded assets)

- Location: `<plugin-dir>/vault/` under the active archive version — synced
  with the library, snapshotted per version, deleted with the plugin on
  uninstall; updates and restarts **keep** it. The zip is reserved: a
  plugin package containing a top-level `vault/` entry is rejected at
  install.
- Isolation: `dest` is vault-relative only (download **and** delete share
  the same path rules) — no absolute paths, no `..`, no drive letters,
  nothing outside the vault, so a download can never overwrite the
  plugin's own bundled files. Bad paths fail with `POLICY` before any
  network request.
- The sandbox module gate allows importing the downloaded files from the
  vault (fs-read only; no writes): a runtime fetched at runtime is just
  plugin code inside the existing sandbox. Use a **variable** specifier so
  the bundler does not inline it:
  `const src = new URL("./vault/runtime.mjs", import.meta.url).href; await import(src)` —
  and prefer `.mjs` (the plugin dir has no `package.json` type field).
- Available everywhere main runs: the plugin CLI answers `UNAVAILABLE`
  (`runPluginHook` has no client to consent), and so does the workbench /
  read-only archive mode.

Sniffed types carry `source: "magic" | "extension"` — content beats
extension names when a signature exists. Prefer `sniff` → `probe`
routing over hand-rolled extension tables.

## Composable detectors

`@hoardodile/sdk-server` exports `all`, `any`, `files`, `hasExt`,
`hasKind`, `hasMime`, `hasName`, `minFiles`, `not` — combine them
instead of reimplementing checks:

```ts
import { any, all, hasExt, not } from "@hoardodile/sdk-server"

const isOurFormat = all(hasExt(".hdtpl"), not(minFiles(0)))
```

## Result helpers

`ok(payload)`, `err({ reasons })`, `isDetected`, `isMissed`, `isOk`,
`isErr`, `matchResult`, `stubLogger` — or return the literal shapes
directly.

## Testing hooks

- **`createResourceAPIFixture<MySchema>(config)`** (no filesystem)
  drives the API from a declarative config: `files`, `contents`,
  `types`, `probes`, `stats`, `byteHashes`, `imageHashes`,
  `containerListings`, `extractions`, `virtualEntries` (container
  addressing), `context`. Paths match exactly, or by `.ext` fragment
  (longest wins), or `""` as the default. It decodes nothing — a hook
  needing real dimensions belongs in a sandbox test.
- **Fixture tables are keyed by path — always.** A bare object like
  `stats: { sizeBytes: 4096 }` is *not* a "default for all paths"; the
  fixture treats any object as a matching table and finds no keys, so
  every `statFile` comes back `undefined` (and the guard that was
  supposed to skip a read doesn't skip). Write per-path keys
  (`stats: { "a.pdf": { sizeBytes: 10 } }`) or a `""` default key
  (`stats: { "": { sizeBytes: 10 } }`).
- **Optional hooks are optional in the type too.** `definePlugin`
  returns `PluginDefinition`, where `sourceMeta`/`listFiles` are
  optional — `plugin.sourceMeta(api)` fails to compile in tests with
  "possibly undefined". Assert with `plugin.sourceMeta!(api)` or wrap
  the plugin in a `Required`-style helper once and reuse it.
- **`detect` for multi-file resources: claim if *any* candidate
  matches.** Iterate the candidates, verify content on each (magic
  header, container listing…), return `{ ok: true }` on the first hit
  and collect reasons only when every candidate failed. Probing only
  the first file rejects good resources that happen to contain one
  stray bad file (a `.pdf`-named text file next to a real PDF).
- **`runPluginHook` / `createDirectoryResourceAPI`** in
  `@hoardodile/host` (devDependency only) run hooks through the same
  capability sandbox the server uses — the exact production execution
  path.
