---
name: hd-plugin
description: Author hoardodile content plugins — manifest, server hooks, iframe client, and the plugin toolchain. Use when building, extending, or debugging a hoardodile plugin, adding a new resource format, or wiring detect/sourceMeta/searchMeta/coverLocal/listFiles/imageHashes.
license: GPL-3.0
metadata:
  author: hoardodile
  version: "1.0.0"
---

# Hoardodile Plugin Development

A hoardodile **content plugin** teaches the app to hoard one more kind of
digital thing. A plugin is three parts that ship together as a zipped
folder: a `manifest.json` (identity, permissions, UI contracts), a
server-side `main.js` (a `definePlugin()` definition: detection,
metadata, covers, file lists, hashes), and a sandboxed iframe client
(the viewer users actually see). The app installs the plugin from
**Settings → Plugins**, validates the manifest, and rescans — resources
the plugin `detect`s become hoardable, searchable, and previewable.

This skill is self-contained: everything below is what a plugin author
needs, verified against the hoardodile SDK sources. Deep-dive material
lives in `references/`.

## When to Apply

- Writing a new content plugin for hoardodile.
- Adding a resource format the app does not already claim (a new file
  kind, a container, a directory “project”, a site export…).
- Extending an existing plugin: new search kinds, metadata, covers,
  anchor jumps, danmaku, image hashes for duplicate detection.
- Debugging `detect`/`sourceMeta`/`searchMeta` results or iframe client
  behavior.
- Building plugin UI — also apply the `hd-plugin-design` skill.

## Workflow

1. **Get the SDK.** `@hoardodile/*` packages are not on npm yet; with a
   hoardodile checkout run `pnpm install && pnpm sdks:pack` (writes
   `tmp/sdks/*.tgz`), then point your plugin at the tarballs via a
   `pnpm-workspace.yaml` with `overrides` — or scaffold with
   `create-hoardodile-plugin --tarballs <dir>`. Once published:
   `pnpm dlx create-hoardodile-plugin <name>`. Full details:
   `references/tooling.md`.
2. **Manifest.** New random UUID for `id` — never reuse one from a
   template. Declare `permissions` honestly (each flag exposes host data
   or UI hooks; `container: true` additionally unlocks
   `listContainer`/`extractArchive`, which the sandbox denies
   otherwise). The server `main.js` runs in a capability sandbox — its
   only privileged interface is the `ResourceAPI` RPC, so never reach
   for `node:` builtins. `references/manifest.md`.
3. **Server side.** `src/main.ts` exports `definePlugin<MySchema>()`.
   `detect` is required and should classify once — the match payload is
   handed to every other hook as `api.context.detect`, so `sourceMeta`
   does not rescan. `references/server.md`.
4. **Client side.** `src/hooks.ts` declares the typed API pair
   (`definePluginAPI`), `src/render.tsx` mounts it
   (`createPluginRoot`). Read files, resolve URLs, write anchors and
   messages through the API. `references/client.md`.
5. **Dev loop.** `hoardodile plugin dev` builds on watch and serves the
   workbench at `http://127.0.0.1:5199`, feeding real sandbox hook
   results into your iframe — no hoardodile server needed.
   `references/tooling.md`.
6. **Test and benchmark.** Vitest against
   `createResourceAPIFixture<MySchema>()`, `detect:smoke` against
   `testdata/`, `hoardodile plugin bench detect .` for latency
   baselines (`bench-detect.json`).
7. **Publish.** Zip `dist/` with `manifest.json` at the zip root and
   upload in **Settings → Plugins**; the app validates, installs, and
   rescans.

## SDK Closure

Plugin **runtime** code may only import `@hoardodile/{ui,sdk-types,sdk-server,sdk-web,sdk-react}`.
The terminal packages — `@hoardodile/cli`, `@hoardodile/host`,
`@hoardodile/host-web`, `@hoardodile/workbench` — are **never** runtime
dependencies; use them as devDependencies only (`runPluginHook`,
`createDirectoryResourceAPI`, workbench). `@hoardodile/ui` is the only
component library; import per-subpath (`components/*`, `theme.css`,
`hooks/*`, `lib/*`, `viewport`) so bundles stay small. Keep the wire
protocol in mind: plugins stamp every outbound message with
`PROTOCOL_VERSION`; the host warns loudly when a plugin was built
against a different version. Plugin bundles never import the
`@hoardodile/sdk-types/schema` subpath (it pulls in `zod`) — import
types from the root entry.

## Reference Files

| File | Contents | When to read |
| --- | --- | --- |
| `references/manifest.md` | Manifest contract: fields, permissions, i18n, `ui` templates, examples | Always, first — writing/editing a manifest |
| `references/server.md` | `definePlugin`, hook contract, `ResourceAPI`, detectors, fixtures | Writing `main.ts` or tests |
| `references/client.md` | Iframe runtime, `sdk-react` API, context pushes, anchors/messages | Writing the viewer or debugging protocol issues |
| `references/tooling.md` | SDK bootstrap, CLI, workbench, testing, bench, deploy | Setting up or publishing a plugin |
| `references/examples.md` | Reference implementations and what each teaches | Before starting, to pick a model to copy |

## Reference Implementations

| Plugin | What it teaches |
| --- | --- |
| `plugins/template` (hoardodile repo) | The minimal end-to-end path: `detect` → `sourceMeta` → iframe render, fixture tests, `detect:smoke`. Start here. |
| `plugins/gallery` (hoardodile repo) | The official media plugin: multi-kind cards (`ui.card.<kind>`), video/audio skipping + probes, danmaku/message/imageHashes permissions, `testdata` generation script, bench baseline. |
| `plugins/file` (hoardodile repo) | The built-in fallback plugin: a resource as a browseable file tree. |
| `plugins/pdf` (hoardodile repo) | Official seed plugin, the newest end-to-end example: multi-candidate `detect`, range-streamed binary via the host file URL, a worker blob fallback for the sandboxed opaque origin, per-page anchors, and structural fixture verification (`testdata:verify`). |

## Resources

- The contract is documented inline in the SDK:
  `plugins/sdk-types/src/plugin-definition.ts` (hooks, definitions,
  fixtures) — the authoritative reference behind `references/server.md`.
- Plugin UI: `@hoardodile/ui` (see `hd-plugin-design`).
- `references/tooling.md` carries the npm-publication status and the
  tarball bootstrap; trust `@hoardodile/*` on the registry once it is
  published.
