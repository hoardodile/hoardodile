# @hoardodile/workbench

Offline dev workbench for hoardodile content plugins: mounts one plugin
iframe against the offline mock host (`@hoardodile/host-web`), fed with
real data by the dev server — no hoardodile server needed.

You normally never touch this package directly. `hoardodile plugin dev`
(resolved from the plugin's own `@hoardodile/workbench` devDependency)
watch-builds a plugin, captures its server-side hook results from the
real worker sandbox, renders preview variants and video frames with the
production pipeline, and serves the workbench at
http://127.0.0.1:5199.

Terminal dev tooling (MIT) — like `@hoardodile/host`, it is not part of
the SDK closure and never enters a shipped plugin bundle.

## Serve entry

`@hoardodile/workbench` exports `serveWorkbench(opts)`, an HTTP server
that serves the prebuilt workbench page plus the plugin's built `dist/`
at `/plugin`. Everything about the *resources* arrives through provider
callbacks, which is what keeps this package dependency-free while still
reaching real data:

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
