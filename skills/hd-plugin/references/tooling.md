# Tooling — Bootstrap, CLI, Workbench, Tests, Deploy

## Getting the SDK (bootstrap)

`@hoardodile/*` are **not published to npm yet** (verified against the
registry). Until they are, build them from a hoardodile checkout:

```bash
git clone https://github.com/hoardodile/hoardodile.git
cd hoardodile
corepack enable && pnpm install
pnpm sdks:pack          # writes tmp/sdks/*.tgz
```

Then point your plugin at the tarballs the same way
`create-hoardodile-plugin --tarballs <dir>` does — a local
`pnpm-workspace.yaml`:

```yaml
packages:
  - "."
overrides:
  "@hoardodile/sdk-types": "file:../hoardodile/tmp/sdks/hoardodile-sdk-types-0.0.0.tgz"
  "@hoardodile/sdk-server": "file:../hoardodile/tmp/sdks/hoardodile-sdk-server-0.0.0.tgz"
  "@hoardodile/sdk-react": "file:../hoardodile/tmp/sdks/hoardodile-sdk-react-0.0.0.tgz"
  "@hoardodile/ui": "file:../hoardodile/tmp/sdks/hoardodile-ui-0.0.0.tgz"
```

Never commit machine-specific paths. Once `@hoardodile/*` are on the
registry, everything above collapses to:

```bash
pnpm dlx create-hoardodile-plugin <name>   # or: hoardodile plugin create <name>
```

## Project anatomy (from the template plugin)

```
manifest.json          identity + permissions + ui contracts
index.html             iframe doc (dev only — the build rewires it)
src/
  main.ts              definePlugin() — the server side
  hooks.ts             definePluginAPI — the typed client API pair
  shared.ts            PluginSchema — typed once for both sides
  render.tsx           createPluginRoot() bootstrap
  index.css            entry styles (e.g. @import "tailwindcss")
  __tests__/           vitest suites
testdata/              sample resources for `plugin dev`
```

Standard scripts (template): `dev` = `hoardodile plugin dev`;
`build` = `hoardodile plugin build`; `watch` = `… --watch`;
`test` = `vitest run`; `detect:smoke` = `hoardodile plugin run detect
testdata --plugin-dir dist`; `lint` = `tsc --noEmit`. Runtime
dependencies: `@hoardodile/sdk-{types,server,react}` (+ `react`,
`react-dom`, and `@hoardodile/ui` for UI); devDependencies:
`@hoardodile/cli`, `@hoardodile/host`, `@hoardodile/host-web`,
`@hoardodile/workbench` + the usual Vite/Vitest/TS toolchain.

## CLI semantics

```bash
hoardodile plugin build           # bundle manifest + client + server hooks into dist/
hoardodile plugin build --watch   # rebuild on change
hoardodile plugin run detect .    # run a hook through the worker sandbox
hoardodile plugin bench detect .  # measure hook latency vs a baseline
hoardodile plugin dev             # watch-build + workbench (http://127.0.0.1:5199)
```

- `run`/`bench` execute hooks through `@hoardodile/host`'s worker
  sandbox with the host's real hook strategy and probe implementations —
  the exact production execution path, so what you test is what runs.
- `bench` writes JSON reports (`bench-detect.json`): machine
  fingerprint, peak RSS, warmup count. `--warmup N` tunes discarded
  runs; `--compare` exits 1 on regression and warns when the baseline
  came from another machine.
- `plugin dev` starts the workbench: it captures the server-side hook
  results (`detect`, `sourceMeta`, `searchMeta`, `listFiles`,
  `coverLocal`) from the real sandbox and feeds them to the iframe — the
  same context the app would push. Its render cache lives in the
  workdir's `.hoardodile/` (gitignore it). No hoardodile server needed.

## Test data and fixtures

- `testdata/` — committed sample data for the workbench and
  `detect:smoke`. Generate synthetic fixtures with a script
  (`scripts/make-testdata.mjs`, like the gallery plugin).
- `testdata-real/` — real-world samples, gitignored (never commit
  copyrighted content).
- `detect:smoke` runs detection against `testdata/` through the real
  sandbox — needs a build first.

## Unit tests

Vitest against `createResourceAPIFixture<MySchema>()` — declarative,
no filesystem, and the same matching rules as the host (`server.md`).
Keep pure-logic tests node-only; component tests run in jsdom. For
hooks that need real probes/decoders, exercise them via `plugin run`
instead of fake results.

## Deploying

1. `hoardodile plugin build` — verify `dist/` contains
   `manifest.json` (at the zip root), `main.js`, and the client bundle.
2. Zip the **contents** of `dist/` — `manifest.json` must be at the
   zip root, not inside a folder.
3. **Settings → Plugins → Upload** in the app. The app validates the
   manifest, installs the plugin, and rescans the library.
4. Test against a library with your kinds; iterate via `plugin dev`.

Bump `manifest.json` version on changes — users see it in Settings →
Plugins.
