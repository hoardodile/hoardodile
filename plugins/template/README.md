# hoardodile plugin template

Minimal end-to-end content plugin: `detect` → `sourceMeta` → iframe render.
Copy this directory to start your own plugin.

## Quick start

Prefer the scaffolder — it regenerates the manifest id, rewrites
`manifest.json`/`package.json` and injects the toolchain config
(`biome.json`):

```bash
pnpm dlx create-hoardodile-plugin my-plugin   # or: hoardodile plugin create my-plugin
```

To start from the repo copy instead (never edit it in place — CI compiles
this copy), add a `biome.json` and a fresh manifest UUID yourself:

```bash
# 1. Copy the template (never edit it in place — CI compiles this copy)
cp -r plugins/template my-plugin

# 2. Generate a fresh manifest UUID — never ship the template's id
node -e "console.log(crypto.randomUUID())"

# 3. Build and validate
pnpm install
pnpm build

# 4. Open the workbench (watch-build + serve at http://127.0.0.1:5199,
#    data from testdata/, plus one sandboxed detect on startup)
pnpm dev
```

## What's inside

- `src/main.ts` — the server-side plugin definition (`definePlugin`):
  `detect` claims resources containing `.hdtpl` files, `sourceMeta`
  lists them. Composable detectors and probe helpers live in
  `@hoardodile/sdk-server`.
- `src/render.tsx` — the iframe client via `@hoardodile/sdk-react`
  (`createPluginRoot`), reading files through the typed API pair in
  `src/hooks.ts`.
- `src/shared.ts` — the plugin schema (`PluginSchema`) typed once and
  shared between the server and client sides.
- `src/i18n.ts` + `src/locales/` — plugin UI strings via
  `createPluginTranslation`, one bundle per supported language (see
  [Localization](#localization)).
- `testdata/` — sample data for `pnpm dev`.
- `__tests__/` — Vitest unit tests against `createResourceAPIFixture`.

## Testing

```bash
pnpm test              # unit tests (in-memory fixture API)
pnpm run detect:smoke  # sandboxed detect against testdata (needs a build first)
```

`hoardodile plugin run` runs hooks through the same worker sandbox the
server uses — the exact production execution path.

## Requirements

- hoardodile **≥ 0.1.1** — the built-in plugin marketplace
  (**Settings → Marketplace**) and the batched asset-download API
  (`download([…])`) when the manifest declares `"download": true`.
  The marketplace's Readme and Release notes tabs and release readme
  assets are read by newer builds; older builds still list and install
  the plugin normally.
- `"minAppVersion"` in `manifest.json` declares the lowest hoardodile
  release this plugin runs on. Hosts below it refuse to install or update
  the plugin (the marketplace gates the install/update entries and zip
  uploads are blocked with an explanation), so bump it only when the
  plugin really needs a newer app. Omit it for plugins that support every
  release.
- The plugin's version is independent of the hoardodile release
  version; bump it on user-visible changes.
- Dev loop: Node ≥ 24, pnpm 11. Toolchain mirrors hoardodile: `biome`
  (format + lint via `pnpm format` / `pnpm lint`), `lefthook` (git hooks —
  `commit-msg` Conventional Commits + `pre-commit` biome/tsc; installed by
  `pnpm install` in a git repo, or `lefthook install` by hand), `vitest`, and
  `release-it` (writes `CHANGELOG.md`, tags `v<version>`).

## Deploying

Publish to the marketplace with one command:

```bash
# 1. Add the repository address to your registry repo's registry.json:
#    { "version": 1, "plugins": ["https://github.com/<owner>/<repo>"] }

# 2. One-click release — release-it bumps the version in package.json AND
#    manifest.json, writes CHANGELOG.md from Conventional Commits, commits,
#    tags `v<version>` and pushes. The tag-triggered `.github/workflows/
#    release.yml` then builds, packages (`release/<id>-<version>.zip` +
#    `.sha256`) and publishes the GitHub release. No local `gh` CLI or token.
pnpm release <version>
```

On `main`, with a clean working tree. The tag must match the manifest version
(`v<manifest.version>`) — the workflow fails otherwise. Then paste the registry
repo address once in **Settings → Marketplace**. The app reads the registry,
each plugin's manifest and its latest release — names, versions, permissions and
release notes come straight from GitHub, so the list never needs editing again.
The zip asset is `<id>-<version>.zip` (produced by `hoardodile plugin package`);
before the first release the plugin shows up with a "no release" state.

Prefer pushing a tag manually (no release-it)? It still works — the workflow
does the same build/package/publish:

```bash
git tag v<version> && git push origin v<version>
```

Local installs (zip upload in **Settings → Plugins**) still work for
private packages.

## Localization

The app is localized in five languages (**en, zh, ja, de, es**). A plugin
can localize three surfaces:

1. **Display name / description** — the `i18n` block in `manifest.json`
   maps `name`/`description` (and any extra label keys) to a locale table;
   the host picks the text for the user's UI language.
2. **Plugin UI strings** — `src/i18n.ts` wraps `createPluginTranslation`
   with one bundle per language in `src/locales/`; the hook starts in the
   host's language and follows `languageChanged` pushes, falling back to
   English for a language the plugin does not ship. `src/__tests__/locales.test.ts`
   keeps the bundles in lockstep (key set, interpolation placeholders,
   no untranslated English copy).
3. **The marketplace readme** — see [Publishing a readme](#publishing-a-readme):
   one `README.<locale>.md` per language, `README.md` as the English
   fallback.

## Publishing a readme

The marketplace detail view shows a per-release **Readme** tab. Ship the
readme markdown in the **`readme/` folder** as a bare **`README.md`**
fallback, plus one `README.<locale>.md` file per extra language (e.g.
`readme/README.md`, `readme/README.zh.md`) — `release.yml` uploads the whole
folder alongside the zip, so **each release carries its own readme** and
every version shows independent notes.
`README.md` is the fallback the app shows for any language without a
specific file, so English normally lives there and you do **not** need a
`README.en.md`. Use the app's supported language codes for the extra files
(`zh`, `ja`, `de`, `es`) — a region-coded name like `README.zh-CN.md` only
matches a UI language resolved to that exact code, so `README.zh.md` is what
Chinese users see.

### Adding images

A readme may reference images. Place the image in `readme/` and
reference it by its **bare filename**:

```md
![Plugin screenshot](screenshot.png)
```

Every file in `readme/` is published as a release asset on each release, and
the app resolves a relative image reference against that release's download
URL. Because a GitHub release is a flat list of assets, the `readme/` folder
must stay **flat** and references must be bare filenames — a nested path
like `![alt](img/shot.png)` resolves to a URL the release does not serve and
the image breaks. Absolute `http(s)://` and `data:` image URIs are allowed.

`pnpm readme:check` (run by `release.yml` before publishing) gates this: it
fails the release if `readme/` is absent-and-required, is not flat, ships no
`README.md` / `README.<locale>.md`, or references an image by a
nested/missing path.

The app resolves the readme for the user's UI language (exact locale → base
language → the `README.md` fallback); the release body always shows
in the **Release notes** tab.
