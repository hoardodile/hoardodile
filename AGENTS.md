# hoardodile

Privacy-first, self-hosted archiving app. pnpm monorepo: Fastify + tRPC server, React SPA (TanStack Router/Query, Tailwind v4, shadcn/ui), iframe content plugins, Drizzle + better-sqlite3.

## Commands

Prerequisites: Node.js 24 + pnpm (corepack); `pnpm install`; copy `.env.example` to `.env`.

- `pnpm dev` — web (Vite HMR) + backend (`vite-node --watch`) + plugin watchers.
- `pnpm build` — turbo build (plugins, web, server); `pnpm lint` / `pnpm format` — biome + tsc; `pnpm test` — turbo test. Lint/test need `pnpm build` first (published-package `default` exports point at `dist/`). Generated files regenerate before their consumers: `apps/web/src/routeTree.gen.ts` before every web build/lint/test, the third-party notices (`apps/web/public/{licenses.json,LICENSE}`) before the web dev/build chain (`scripts/generate-licenses.mjs`; CI gates the notice license policy via `pnpm licenses:check`).
- One package: `turbo run test --concurrency=2 --filter=<package>`; `pnpm db:generate` — regenerate Drizzle migrations.
- `pnpm desktop` — Electron dev shell; packaging per platform (`desktop:package` = Windows x64 NSIS+zip, `:linux` = AppImage, `:mac` = arm64 dmg+zip) stages the server runtime (`scripts/stage-runtime.mjs`, seed set per `scripts/lib/plugin-channels.mjs`) + a Node 24 sidecar, then self-checks (`verify-package.mjs`, yml-driven `verify-feed.mjs`); `package:dir` + `test:e2e` = packaged Playwright launch smoke. Details: `apps/desktop/README.md`.
- `pnpm docker:smoke` — compose health/SPA/persistence check; CI also runs the web e2e against the container (`E2E_EXTERNAL_BASE_URL`).
- `pnpm seed` — demo data only (refuses non-empty libraries and packaged runtimes; admin password `demo`); `pnpm -F @hoardodile/server reset` / `reset:dev` — drop the admin password.
- `hoardodile plugin <create|build|package|run|bench|dev>` — plugin CLI (package = zip `dist/` into `release/<id>-<version>.zip` for a GitHub release); scaffold via `pnpm dlx create-hoardodile-plugin <name>`.

Server config: env vars only, validated in `apps/server/src/config/env.ts` — no CLI flags.

## Coding rules

- Elegance beats brevity; no speculative abstractions; functions with >4 parameters become one options object. Prefer type guards / `satisfies` over `as`; plain-function component calls outside React render need `"use no memo"`. Check [DESIGN.md](DESIGN.md) before reshaping any UI.
- Links outside the SPA go through `ExternalLink` (pre-commit guard); on desktop, same-origin SPA-route navigations stay in-window, every other URL opens in the OS browser (`apps/desktop/src/main/urls.ts`).
- Never edit non-ASCII files (i18n JSON, docs) via PowerShell string replacement — use the edit tool.

## Dependencies

- Runtime deps live in the package that uses them; shared versions via `catalog:` in `pnpm-workspace.yaml`; `apps/server` ships a production `node_modules`.
- SDK closure (`@hoardodile/{i18n,ui,sdk-*}`) must not import outside itself (`sdks:pack`); terminal packages (`cli`, `host`, `host-web`, `workbench`) are never imported by plugin code; `host`/`host-web` and the SDKs ship `src` alongside `dist`.
- Pinned by `scripts/guard-protected-deps.mjs` (pre-commit + CI): `@blocknote/*` 0.51.4 (+ `@handlewithcare/prosemirror-suggest-changes` 0.1.8), `@videojs/react` 10.0.0-beta.25, `typescript: 5.9.3` in the tsup-built packages — an intentional bump follows the checklist in `apps/web/src/features/doc/README.md`.

## Structure

```
apps/
  web/         React SPA (routes/, features/, components/, i18n/)
  server/      Fastify (domain/, infra/, config/)
packages/
  shared/      App-internal utils (incl. dayjs re-export)
  schemas/     App-internal Zod schemas (tables live in domain/*/schema.ts)
  i18n/        Published shared catalogs + i18next factory (app `translation` + component `ui` namespaces; used by the SPA, the desktop shell and the plugin SDK)
  ui/          Published shadcn/ui
  cli/         Developer CLI — hoardodile plugin create/build/package/run/bench/dev
plugins/
  sdk-{types,server,web,react}/  Plugin contract + authoring SDK + iframe runtime
  host/        App-side runtime host — sandbox, hooks, storage (src/hoard/ + src/media/)
  host-web/    Browser-side host runtime (protocol router, mock host)
  workbench/   Offline dev tool (`hoardodile plugin dev`)
  create-plugin/  Interactive scaffolder (embeds a build-time copy of template/)
  file/        Built-in fallback plugin
  gallery/     Official preinstalled media gallery
  pdf/         Official preinstalled PDF reader
  template/    Third-party plugin starting point
scripts/       Root dev/license/guard/version scripts
.agents/skills/  Repo-local agent skills
```

## Architecture

- Domain-driven: `schema.ts` → `repo.ts` → `service.ts` → `router.ts` (+ often Fastify `plugin.ts`); services are `create*Service(deps)` factories.
- Plugins: `manifest.json` + server `main.js` (`definePlugin()`) + sandboxed iframe client; `plugins/host/src/hooks.ts` is the ONLY way to invoke plugin hooks (workers run under the Node permission model). Authoring: `plugins/template` + [packages/cli/README.md](packages/cli/README.md).
- Storage: layout authority `createStoragePaths` (`plugins/host/src/hoard/paths.ts`); writes under `versions/<v>/` go through `writeVersioned` targeting the latest version (`scripts/guard-versions.mjs`; exemptions need `// write-guard-exempt`); live DB `{STORAGE_ROOT}/app.sqlite`, `versions/<v>/` frozen, `local/` host-only.
- Tags: identity `(category, name)`, globally unique. Sync: per-device snapshots in `domain/sync/`. Privacy: `performSignOut` (`apps/web/src/features/privacy/`) is the only sign-out path. Trace (`user_actions`) and usage (`usage_sessions`) are separate domains — never mix.

## Testing

- Vitest at `src/**/*.test.{ts,tsx}` (server: node; web/plugins: jsdom); bench runs manually.
- E2E: Playwright critical-path smoke only (`apps/web/e2e/` + the desktop launch smoke) — prefer Vitest + Testing Library; select by `data-testid`/role.
- Expected filesystem paths in tests come from `join()`/`resolve()`/`sep`, never drive-letter/backslash literals — Windows-behavior cases are exempted with `// path-guard-exempt` (`scripts/guard-portable-tests.mjs`, pre-commit + CI).

## Generated files — never hand-edit

`apps/server/src/infra/db/migrations/`, `CHANGELOG.md`, `pnpm-lock.yaml`, `plugins/create-plugin/src/sdk-deps.gen.ts`, `plugins/create-plugin/dist/template/` (generated from `plugins/template` by `scripts/copy-template.mjs` at build time — edit `plugins/template`). `apps/web/src/routeTree.gen.ts` and `apps/web/public/{licenses.json,LICENSE}` are not committed at all — they regenerate before their consumers (route tree: every web build/lint/test; notices: the web dev/build chain).

Drizzle migration pitfalls: split add+drop into two `db:generate` runs; `ADD COLUMN` silently drops FK actions like `ON DELETE CASCADE` — verify the SQL.

## Commits & releases

- Conventional Commits (`type(scope): subject`; scope = workspace package name); one cohesive unit per commit; pre-commit = lint-staged + `pnpm lint` + version/versioned-write guards.
- **Before committing:** `pnpm format` → `pnpm lint` → `turbo run test --concurrency=2 --filter=<changed packages>`, all green.
- **Never merge, rebase, push, or delete branches.** Never hand-edit a `version` field; never re-run `pnpm release` for an already-tagged version.
- Release: `pnpm release <version>` (bump/tag/push + **draft** GitHub Release) → tag-triggered `release.yml` publishes npm + the per-platform desktop installers → a human publishes the draft (the updater sees it then). Pre-1.0: breaking changes allowed, but flag them first.

## Guardrails

- No telemetry or external calls — the only authorized requests: the user-triggered update check (desktop `autoUpdate` may fetch GitHub Release artifacts while the tray is alive), user-consented plugin downloads (the asset API's shared consent dialog; files land only in the plugin's own `vault/`), and the plugin marketplace's GitHub fetches (built-in default registry [`hoardodile/marketplace`](https://github.com/hoardodile/marketplace); a custom registry is opt-in): catalog refresh (registry + per-plugin manifests via raw URLs + the latest release via the free `releases.atom` feed + the asset list via `github.com/<repo>/releases/expanded_assets/<tag>` + per-release `README.<locale>.md` assets — all quota-free GitHub web endpoints, no `api.github.com`, server-side, cached 24 h by default (env-configurable via `MARKETPLACE_CACHE_TTL_MS` / `MARKETPLACE_RELEASE_CACHE_TTL_MS` / `MARKETPLACE_RATE_LIMIT_COOLDOWN_MS`), on page open or explicit refresh) and user-confirmed install/update downloads (same hardened HTTP client; GitHub release hosts only).
- Outbound fetches honor the user's proxy by default (`HOARDODILE_PROXY` explicit override, `off` to disable; auto-detected from `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` and the Windows/macOS system proxy; `NO_PROXY` keeps those hosts direct). The proxy is transport only — destinations stay the authorized hosts above; TLS verification and the public-address policy are unchanged. Settings → About exposes read-only network diagnostics plus a user-triggered connectivity probe against `raw.githubusercontent.com`.
- No git mutations unless explicitly asked.
- **Ask the user before modifying AGENTS.md.**
