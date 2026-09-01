# @hoardodile/create-plugin

Interactive scaffolder for hoardodile content plugins. Copies the
template generated from `plugins/template` at build time, rewrites the
manifest with a fresh UUID, rewires dependency specs, installs,
validates the result, and prints the dev-loop entry points.

## Usage

```bash
# installs the published @hoardodile/* SDK packages from npm
create-hoardodile-plugin my-plugin

# offline / self-contained: consume the packed tarballs instead
create-hoardodile-plugin my-plugin --tarballs ../hoardodile/tmp/sdks
```

## What you get

A complete plugin directory: `manifest.json` (fresh UUID — never ship
the template's id), `src/main.ts` (`definePlugin` with `detect` +
`sourceMeta`), `src/render.tsx` (`createPluginRoot` + typed API pair),
`src/shared.ts` (the `PluginSchema` declared once), `testdata/` and
Vitest unit tests against `createResourceAPIFixture`. It also ships the
development toolchain hoardodile uses — `biome.json` (format + lint),
`lefthook.yml` (git hooks: Conventional-Commits `commit-msg` + biome/tsc
`pre-commit`, installed by `postinstall` in a git repo), the release-it
changelog/release setup, and `AGENTS.md`.

```bash
cd my-plugin
pnpm dev      # watch-build + workbench at http://127.0.0.1:5199
pnpm test     # unit tests against the fixture API
pnpm build    # dist/ — zip its contents (manifest at the zip root) and upload
```

MIT License.
