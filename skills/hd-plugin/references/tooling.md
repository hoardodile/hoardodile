# Tooling — Bootstrap, CLI, Workbench, Tests, Deploy

## Getting the SDK (bootstrap)

The `@hoardodile/*` release set is on npm (0.1.8): the SDK closure
(`sdk-{types,web,react,server}`, `ui`, `i18n`) plus the terminal
packages (`cli`, `host`, `host-web`, `workbench`) and the
`create-plugin` scaffolder. Install from the registry directly — no
tarballs, no `file:` overrides:

```bash
pnpm dlx create-hoardodile-plugin <name>   # or: hoardodile plugin create <name>
```

- Requires Node ≥ 24 (the scaffolder's `engines`).
- The scaffolder rewrites every `@hoardodile/*` spec to
  `^<its own version>` (prerelease suffixes dropped) and installs from
  the registry. A 0.x caret is effectively pinned — bump the spec to
  adopt a newer SDK release.

## Project anatomy (from the [template plugin](../../../plugins/template))

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
README.md / README.<locale>.md   per-release marketplace readme — bare `README.md` is the fallback (see below)
CONTRIBUTING.md        dev loop, releases, marketplace publishing
SECURITY.md            private-advisory reporting policy
.github/               CI, dependabot, issue templates, release workflow
biome.json              formatter + linter (injected by the scaffolder; pnpm format / pnpm lint)
lefthook.yml            git hooks (commit-msg Conventional Commits, pre-commit biome/tsc)
AGENTS.md               agent instructions (uppercase, per repo convention)
.nvmrc / .gitignore    Node 24 pin / artifact ignores
```

Standard scripts (template): `dev` = `hoardodile plugin dev`;
`build` = `hoardodile plugin build`; `watch` = `… --watch`;
`test` = `vitest run`; `detect:smoke` = `hoardodile plugin run detect
testdata --plugin-dir dist`; `lint` = `biome check . && tsc --noEmit`;
`format` = `biome check --write`; `lint-staged` = the pre-commit biome
pass; `postinstall` installs `lefthook` hooks when the repo has a
`.git`. Runtime
dependencies: `@hoardodile/sdk-{types,server,react}` (+ `react`,
`react-dom`, and [`@hoardodile/ui`](https://www.npmjs.com/package/@hoardodile/ui) for UI); devDependencies:
`@hoardodile/cli`, `@hoardodile/host`, `@hoardodile/host-web`,
`@hoardodile/workbench` + the usual Vite/Vitest/TS toolchain.

### tsconfig — standalone vs in-repo

- **Standalone plugin** (copied out of the repo): the template's own
  `tsconfig.json` works everywhere.
- **In-repo plugin** (under `plugins/`, official): extend the web
  config like `gallery`/`file` do —
  `{ "extends": "../../tsconfig.web.json", "include": ["src/**/*.ts",
  "src/**/*.tsx"] }`. It pulls `@testing-library/jest-dom` into `types`,
  so the plugin must declare it in devDependencies or `tsc` fails with
  "Cannot find type definition file for '@testing-library/jest-dom'".

### `@hoardodile/ui/theme.css` needs its import chain

`theme.css` starts with `@import "tailwindcss"`, `@import
"tw-animate-css"` and `@import "shadcn/tailwind.css"`. In the monorepo
those resolve by hoisting; a standalone plugin must provide them as
devDependencies (`shadcn`, `tw-animate-css`, `tailwindcss`) or the
build fails at CSS import resolution.

### Verify third-party libraries against the bundled version

Viewer libraries move their public API between majors (pdf.js v6
dropped `enableRange` — range streaming is on by default — and made
`render({ canvas })` a required parameter). Pin the version, then check
the `.d.ts` of the version you actually bundle before writing calls
from memory or old docs.

## CLI semantics

```bash
hoardodile plugin build           # bundle manifest + client + server hooks into dist/
hoardodile plugin build --watch   # rebuild on change
hoardodile plugin run detect .    # run a hook through the capability sandbox
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
- **Resource-card preview.** The top bar's **Card** button opens a dialog
  showing a simulated resource card — the plugin's
  `manifest.ui.card.<kind>` corner templates (`tl`/`bl`/`br`) rendered
  against the resource (file stats, source/search meta) plus the cover.
  The dev pipeline sniffs the cover source (`coverLocal`) to determine
  the kind (`image`/`video`/`audio`, else `default`), so the block
  matching the cover is used. Iterate on `manifest.ui.card` and
  `coverLocal`, then reload to see the card — the app's shared
  `@hoardodile/ui/res-card-template` renderer evaluates the same
  `{{...}}` grammar in the app and the workbench.
- **Plugin asset downloads in the workbench** work the same way as the
  app: the same consent dialog (Allow / Deny / remember-this-session),
  backed by the dev server instead of tRPC. Declare `"download": true`
  in the manifest; on `download()` (single or batched) the dialog
  appears — one dialog per call, listing every item of a batch — and on
  approval the dev server fetches the URLs into
  `<pluginDir>/.hoardodile/vault/<id>/…`
  (never in `--data` or the read-only `--storage` library) and serves it
  at `/api/plugin-assets/<id>/<token>/<path>` — the token is dev-only and
  not verified, so `resolveAssetUrl` works unmodified. The same policy
  subset applies: http(s) only, ≤5 redirects, `WORKBENCH_VAULT_MAX_BYTES`
  cap (default 200 MiB), optional sha256 pin, atomic write.
- **Plugin state in the workbench.** The workbench previews your plugin
  against the real library **read-only**, so its stored `prefs` (settings)
  and per-resource `cache` are seeded from the library. To develop from a
  clean slate, open the **Settings** dialog → **Plugin state**: **Reset**
  empties the plugin's prefs, **Clear** empties the current resource's
  cache, and **Restore from library** brings the stored values back (the
  reader reloads on each action). The cleared state is a workbench-local
  override (localStorage), so it survives the Reload button and resource
  switches until you restore — your real library is never written to.

## Test data and fixtures

- `testdata/` — committed sample data for the workbench and
  `detect:smoke`. Generate synthetic fixtures with a script
  (`scripts/make-testdata.mjs`, like the gallery plugin).
- `testdata-real/` — real-world samples, gitignored (never commit
  copyrighted content).
- `detect:smoke` runs detection against `testdata/` through the real
  sandbox — needs a build first.
- **Verify binary fixtures with a real parser.** The `plugins/pdf`
  plugin keeps `testdata:verify`: a Node script opens every sample with
  the actual library and asserts page counts and that page 2 extracts
  text — the regression check that catches PDFs which open but never
  render. Do the same for any fixture format your plugin renders.

## Unit tests

Vitest against `createResourceAPIFixture<MySchema>()` — declarative,
no filesystem, and the same matching rules as the host (`server.md`).
Keep pure-logic tests node-only; component tests run in jsdom. For
hooks that need real probes/decoders, exercise them via `plugin run`
instead of fake results.

## Deploying

Local install first — the app's installer is **zip-only**, and
`hoardodile plugin package` always produces the zip the server expects:

1. `hoardodile plugin build` — verify `dist/` contains
   `manifest.json` (at the zip root), `main.js`, and the client bundle.
2. Zip the **contents** of `dist/` — `manifest.json` must be at the
   zip root, not inside a folder (checksum-verified by the marketplace
   when the release ships a `.sha256` sidecar).
3. **Settings → Plugins → Upload** in the app. The app validates the
   manifest (including `minAppVersion`), installs the plugin, and
   rescans the library.
4. Test against a library with your kinds; iterate via `plugin dev`.

Bump `manifest.json` version on changes — users see it in Settings →
Plugins.

## Publishing to the marketplace

The built-in registry is [`hoardodile/marketplace`](https://github.com/hoardodile/marketplace); the app reads a
registry repo's `registry.json`, which lists plugin repository addresses:

```json
{ "version": 1, "plugins": ["https://github.com/<owner>/<repo>"] }
```

Publishing is a tag, not a build:

The template ships a one-click path: `pnpm release <version>` (release-it)
bumps `package.json` **and** `manifest.json` in lockstep
(`scripts/sync-version.mjs`), writes `CHANGELOG.md`, commits
`chore(release): v<version>`, tags and pushes — then the tag triggers the
same `release.yml` below. Pushing the tag by hand still works as a
fallback (`git tag v<version> && git push origin v<version>`), but the
tag must match `v<manifest.version>` or the workflow fails.

1. `hoardodile plugin package` (or the release workflow) produces
   `release/<id>-<version>.zip` + `.<sha256>`.
2. Ship a bare `README.md` fallback plus a `README.<locale>.md` file per
   extra language in the `readme/` folder — the marketplace detail view
   shows the release's **Readme** tab, resolved for the user's UI language
   (exact locale → base language → the `README.md` fallback), and the
   release body always shows in **Release notes**. `README.md` normally
   carries the English text, so no `README.en.md` is needed; use the app's
   language codes for the extra files (`README.zh.md`, `README.ja.md`,
   `README.de.md`, `README.es.md`).
3. Push a tag `v<version>` matching `manifest.json` — the template's
   [`.github/workflows/release.yml`](../../../plugins/template/.github/workflows/release.yml) builds, runs `plugin package`,
   gates the `readme/` folder with `pnpm readme:check`, and creates the
   GitHub release with the zip, the sha256 and every `README.*.md` asset.
4. Add the repository address to your registry's `registry.json`.

Requirements: all repos are public; tags follow `v<version>`. The app
caches the catalog for 10 minutes and honors the user's proxy config;
installs/updates are user-confirmed downloads of the release zip, and
hosts below the plugin's `minAppVersion` hide the entries. The
**Bundled plugins** section (Settings → Plugins) restores
ships-with-app plugins a user uninstalled — offline.
