# hoardodile plugin template

Minimal end-to-end content plugin: `detect` → `sourceMeta` → iframe render. Copy this directory to start your own plugin — never edit it in place (the create-plugin scaffolder embeds a synced copy; CI compiles it).

## Commands

- `pnpm build` — build `dist/` (client + server bundle + manifest).
- `pnpm dev` — watch-build + serve the workbench at http://127.0.0.1:5199 (data from `testdata/`, one sandboxed `detect` on startup).
- `pnpm test` — Vitest against the in-memory fixture API; `pnpm run detect:smoke` — sandboxed `detect` against `testdata/` (needs a build first).
- `hoardodile plugin <run|package|dev>` — run hooks through the same worker sandbox the server uses (`run`), zip `dist/` into `release/<id>-<version>.zip` (`package`), or the offline dev workbench (`dev`).
- `pnpm readme:check` — gate the marketplace `readme/` folder (flat, ships one `README.md` fallback per locale). `pnpm release <version>` — release-it bumps version, writes `CHANGELOG.md`, tags `v<version>`, and the tag workflow builds/packages/uploads the GitHub release assets.

Scaffold a new plugin with `pnpm dlx create-hoardodile-plugin <name>`; it rewrites `manifest.json`/`package.json` and installs deps.

## Structure

```
src/main.ts      server-side definition (definePlugin): detect + sourceMeta
src/shared.ts    PluginSchema typed once, shared server ↔ client
src/hooks.ts     typed plugin API (definePluginAPI) for the client
src/render.tsx   iframe client (createPluginRoot @hoardodile/sdk-react)
testdata/        default data root for `hoardodile plugin dev`
__tests__/       unit tests
```

## Architecture

- **Contract:** `manifest.json` + server `main.js` (`definePlugin`) + sandboxed iframe client. `manifest.ui.card`/`.search`/`.message` declare host-rendered `{{...}}` templates; the CLI lints them at build time (`packages/cli/src/template-lint.ts`), so a template that renders in the workbench renders in the app.
- **SDK closure:** plugin code may import only `@hoardodile/{i18n,ui,sdk-*}`; terminal packages (`cli`, `host`, `host-web`, `workbench`) are never imported by a plugin. `plugins/host/src/hooks.ts` is the only path to invoke plugin hooks.

## Testing

Vitest unit tests use `createResourceAPIFixture` (in-memory); the sandboxed path is exercised via `hoardodile plugin run detect testdata --plugin-dir dist` — the exact production execution path.
