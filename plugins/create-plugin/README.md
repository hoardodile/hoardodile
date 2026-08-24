# @hoardodile/create-plugin

Interactive scaffolder for hoardodile content plugins. Copies the
embedded template (kept in sync with `plugins/template` — CI checks for
drift), rewrites the manifest with a fresh UUID, rewires dependency
specs, installs, validates the result, and prints the dev-loop entry
points.

## Usage

```bash
# installs the published @hoardodile/* SDK packages from npm
create-hoardodile-plugin my-plugin

# pre-release / offline: consume the packed tarballs instead
create-hoardodile-plugin my-plugin --tarballs ../hoardodile/tmp/sdks
```

## What you get

A complete plugin directory: `manifest.json` (fresh UUID — never ship
the template's id), `src/main.ts` (`definePlugin` with `detect` +
`sourceMeta`), `src/render.tsx` (`createPluginRoot` + typed API pair),
`src/shared.ts` (the `PluginSchema` declared once), `testdata/` and
Vitest unit tests against `createResourceAPIFixture`.

```bash
cd my-plugin
pnpm dev      # watch-build + workbench at http://127.0.0.1:5199
pnpm test     # unit tests against the fixture API
pnpm build    # dist/ — zip its contents (manifest at the zip root) and upload
```

MIT License.
