# Reference Implementations

Copy the closest match; read the smaller ones before the bigger ones.
"hoardodile repo" paths below are relative to
`github.com/hoardodile/hoardodile`.

| Plugin | Location | What it teaches |
| --- | --- | --- |
| **Template** | `plugins/template` (hoardodile repo) | The minimal end-to-end path, exactly four files: `main.ts` (detect → sourceMeta), `hooks.ts` (typed API pair), `render.tsx` (root), `shared.ts` (schema). Plus fixture-based unit tests and `detect:smoke`. **Start here.** |
| **Gallery** | `plugins/gallery` (hoardodile repo) | The official media plugin: `ui.card.<kind>` per media kind, `sourceMeta` with probe results (width/height/duration), `danmaku` + `message` + `imageHashes` permissions in action, danmaku player UI using `@hoardodile/ui` components, `file.preview`/original toggle via `resolveFileUrl` variants, `scripts/make-testdata.mjs`, `bench-detect.json` baseline. |
| **File** | `plugins/file` (hoardodile repo) | The built-in fallback: a resource as a browsable file tree (`tree.tsx`), virtual entries, and what "keep it simple" looks like when nothing else matches. |
| **Spine** (community) | `plugin-spine` | One viewer across a version range (JSON + `.skel` via version-pinned runtimes), an extra search kind (`ex`), a scene selector for multi-skeleton resources, `{{join(' ', searchKindIcons(), number(source.animationCount))}}` cards, and a dev loop documented to capture real sandbox hook results. |
| **Manga** (community) | `plugin-manga` | A CBZ-type container: `listContainer`/`extractArchive`, `outer!inner` addressing, and staged page loading in the iframe. |
| **Novel** (community) | `plugin-novel` | Text-heavy reading UI: `sourceMeta` drafts, `searchMeta` for book search, and long-form iframe layout. |
| **Live2D** (community) | `plugin-live2d` | A binary/asset-heavy format: detection by local model + runtime assets, source metadata, and a viewer with its own web runtime. |

Community plugin names above appear in the hoardodile ecosystem; fetch
them from wherever the author published them — the value is in the
pattern, not the version.

## What to copy, what to redo

- Copy: manifest structure, hook naming, the schema shape, fixture
  tests, `testdata/` + `detect:smoke` loop.
- Redo: the `id` (always a new UUID), the detection logic, the iframe
  UI, the i18n labels.
- Do not ship: template `ids`, machine-specific tarball paths, real
  sample data in `testdata/`.
