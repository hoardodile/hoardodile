# hoardodile plugin template

Minimal end-to-end content plugin: `detect` → `sourceMeta` → iframe render.
Copy this directory to start your own plugin.

## Quick start

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
- The plugin's version is independent of the hoardodile release
  version; bump it on user-visible changes.
- Dev loop: Node ≥ 24, pnpm 11.

## Deploying

Publish to the marketplace with two steps:

```bash
# 1. Add the repository address to your registry repo's registry.json:
#    { "version": 1, "plugins": ["https://github.com/<owner>/<repo>"] }

# 2. Tag the release — `.github/workflows/release.yml` builds, packages
#    (`release/<id>-<version>.zip` + `.sha256`) and publishes the GitHub
#    release automatically. No local `gh` CLI or token needed.
git tag v<version> && git push origin v<version>
```

The tag must match the manifest version (`v<manifest.version>`) — the
workflow fails otherwise. Then paste the registry repo address once in
**Settings → Marketplace**. The app reads the registry, each plugin's
manifest and its latest release — names, versions, permissions and
release notes come straight from GitHub, so the list never needs editing
again. The zip asset is `<id>-<version>.zip` (produced by
`hoardodile plugin package`); before the first release the plugin shows
up with a "no release" state.

Local installs (zip upload in **Settings → Plugins**) still work for
private packages.
