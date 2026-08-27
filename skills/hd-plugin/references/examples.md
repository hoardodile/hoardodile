# Reference Implementations

Copy the closest match; read the smaller ones before the bigger ones.
"hoardodile repo" paths below are relative to the
[hoardodile repository](../../../).

| Plugin | Location | What it teaches |
| --- | --- | --- |
| **Template** | [`plugins/template`](../../../plugins/template) (hoardodile repo) | The minimal end-to-end path, exactly four files: `main.ts` (detect → sourceMeta), `hooks.ts` (typed API pair), `render.tsx` (root), `shared.ts` (schema). Plus fixture-based unit tests and `detect:smoke`. **Start here.** |
| **Gallery** | [`plugins/gallery`](../../../plugins/gallery) (hoardodile repo) | The official media plugin: `ui.card.<kind>` per media kind, `sourceMeta` with probe results (width/height/duration), `danmaku` + `message` + `imageHashes` permissions in action, danmaku player UI using [`@hoardodile/ui`](https://www.npmjs.com/package/@hoardodile/ui) components, `file.preview`/original toggle via `resolveFileUrl` variants, `scripts/make-testdata.mjs`, `bench-detect.json` baseline. |
| **File** | [`plugins/file`](../../../plugins/file) (hoardodile repo) | The built-in fallback: a resource as a browsable file tree (`tree.tsx`), virtual entries, and what "keep it simple" looks like when nothing else matches. |
| **PDF** | [`plugins/pdf`](../../../plugins/pdf) (hoardodile repo) | The newest seed plugin — same wiring as gallery (desktop seed, version sync, `stage-resources`). Teaches: content-based `detect` across multiple files (claim if any candidate is real), range-streaming a large binary via `resolveFileUrl` vs `readFile` fallback, a module-worker blob fallback for the sandboxed opaque origin, per-page comment anchors (`decodeAnchor` receives `anchor.data`; `{{inc()}}` templates), minimal fit-width viewer with explicit render-error states, and `testdata:verify` (real-parser structural regression over binary fixtures). |

## What to copy, what to redo

- Copy: manifest structure, hook naming, the schema shape, fixture
  tests, `testdata/` + `detect:smoke` loop.
- Redo: the `id` (always a new UUID), the detection logic, the iframe
  UI, the i18n labels.
- Do not ship: template `ids`, real sample data in `testdata/`.
