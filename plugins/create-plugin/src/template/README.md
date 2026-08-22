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

## Deploying

Zip the contents of `dist/` (with `manifest.json` at the zip root) and
upload in **Settings → Plugins**. The app validates the manifest,
installs it, and rescans.
