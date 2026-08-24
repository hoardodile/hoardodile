# @hoardodile/workbench

Offline dev workbench for hoardodile content plugins: mounts one plugin
iframe against the offline mock host (`@hoardodile/host-web`), fed with
real data by the dev server — no hoardodile server needed. The workbench
page itself is a small React app built on `@hoardodile/ui` (the same
design system and theme tokens the app and plugins use).

You normally never touch this package directly. `hoardodile plugin dev`
(resolved from the plugin's own `@hoardodile/workbench` devDependency)
watch-builds a plugin, captures its server-side hook results from the
real worker sandbox, renders preview variants and video frames with the
production pipeline, and serves the workbench at
http://127.0.0.1:5199.

Terminal dev tooling (MIT) — like `@hoardodile/host`, it is not part of
the SDK closure and never enters a shipped plugin bundle.

## Page

The chrome strip shows the plugin name, the resource picker (with the
rendered cover thumbnail, hidden automatically when the render pipeline
is not wired), the hook status line and the current viewport. The plugin
iframe floats as the design system's card surface on the canvas.

### Iframe settings

The Configure popover edits every iframe configuration item, and their
defaults are the main app's hardcoded defaults (so the workbench shows
the plugin exactly as it ships):

| Setting | Default | App source |
| --- | --- | --- |
| Theme mode | System (follows the OS) | `ThemeProvider` `defaultTheme` |
| Palette | Mono | `ThemeProvider` `defaultPalette` |
| Icon style | Duotone | `IconStyleProvider` `defaultStyle` |
| Language | System (`navigator.language`, "en" fallback) | app i18n detection |
| Font family | Empty (app system stack) | the app's unset font pref |
| Viewport | Fill (the app preview surface) | the preview dialog |

The workbench chrome itself is localized in the same five official
languages (en/zh/ja/de/es): the chosen language drives both the chrome
and the `languageChanged` push to the mounted iframe. Shared option names
(palette/icon style/language) come from the app catalogs; the workbench's
own copy lives in the `workbench` namespace of `@hoardodile/i18n`.

Manual acceptance after an i18n change (`hoardodile plugin dev`): switch
through all five languages and check that (1) the workbench chrome
follows immediately, (2) the plugin iframe switches without a reload,
(3) plugin strings the bundle lacks fall back to English.

Theme, palette, icon style, language and font changes are pushed to the
mounted iframe (theme/fonts/language pushes) without a reload — the same
protocol the app's theme broadcast uses. A plugin built against a
vanilla SDK that never subscribed to those pushes keeps its initial
context; the Reload button re-posts the context with the current values.
Element-level iframe attributes (sandbox, referrer policy, fullscreen,
title) and the injected viewport meta stay fixed at the app's values.

Settings persist in localStorage under a workbench-only key, so they
survive a `plugin dev` restart.

## Serve entry

`@hoardodile/workbench` exports `serveWorkbench(opts)`, an HTTP server
that serves the prebuilt workbench page plus the plugin's built `dist/`
at `/plugin`. Everything about the *resources* arrives through provider
callbacks, which is what keeps the serve entry dependency-free while
still reaching real data (the React UI is prebuilt and inlined in the
published `dist/`):

| Provider | Feeds |
| --- | --- |
| `resources()` | the resource picker |
| `files` | `/data` reads and the plugin file URL shape |
| `snapshot(resId)` | sandboxed `detect` / `sourceMeta` / `searchMeta` / `listFiles` / `coverLocal` / `imageHashes` |
| `state(resId)` | seeds the mock host with the resource's comments, danmaku, prefs and cache |
| `preview(resId, path)` | `?size=preview` variants |
| `frame(resId, path, timeMs)` | video seek-preview thumbnails |

`hoardodile plugin dev` supplies all of them. Omit one and the matching
capability degrades honestly: without `preview` the original bytes are
served, without `frame` the route stays unmounted, and the page's status
line says so.

Run standalone against a plain directory when you only need the client
side:

```bash
node dist/serve.mjs --plugin ./dist --data ./testdata --port 5199
```

### Routes

```
GET /plugin/*                                  built plugin bundle
GET /data/<path>[?res=]                        raw entry bytes
GET /data/?list=1[&res=]                       entry names
GET /data/?stat=<path>[&res=]                  entry size
GET /api/workbench/resources                   resource picker list
GET /api/workbench/context?res=<id>            hooks + seeded state
GET /api/resources/:id/files/:token/*          plugin file URLs
GET /api/resources/:id/frame/:token/:name/:ms  video seek frame
```

The routing lives in one module (`scripts/mounts.mjs`) shared by the
vite dev server and the published standalone server, so a route can
never exist in only one of them.

## Docs

- [Plugin development](https://docs.hoardodile.com/plugin-development/) —
  the dev loop
- [Getting started](https://docs.hoardodile.com/getting-started/)
