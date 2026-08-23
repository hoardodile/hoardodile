# hoardodile

Privacy-first, self-hosted archiving app. pnpm monorepo: Fastify + tRPC server, React SPA (TanStack Router/Query, Tailwind v4, shadcn/ui), iframe content plugins, Drizzle + better-sqlite3.

## Commands

Prerequisites: Node.js 24, pnpm via corepack, then `pnpm install`. Copy `.env.example` to `.env` for local defaults.

- `pnpm dev` — web (Vite HMR) + backend (`vite-node --watch`) + plugin watchers; `HOST`, `PORT`, `STORAGE_ROOT` from env.
- `pnpm build` — turbo build (plugins, web, server); server embeds web dist + Drizzle migrations.
- `pnpm lint` / `pnpm format` — biome + tsc / format. Turbo `lint`/`test` build first (published-package `default` exports point at `dist/`).
- Tests for a changed package: `turbo run test --concurrency=2 --filter=<package>` (e.g. `@hoardodile/web`).
- `pnpm db:generate` — regenerate Drizzle migrations.
- `pnpm desktop` — Electron shell; dev loop (`apps/desktop/scripts/dev.mjs`: never starts or owns the SPA and never waits for it — resolves `HOARDODILE_WEB_URL` or the default port and launches regardless; when `pnpm dev`'s Vite is absent the shell window shows its own Retry page (start `pnpm dev`, press Retry); starts the wizard on a free port; tree-kills the sidecar on exit), production windows load the sidecar-served SPA. `desktop:package` = Windows x64 NSIS installer + portable zip: stages `apps/server/dist` (with its native `node_modules`) into `extraResources` via `stage-resources.mjs`, then `verify-package.mjs` re-checks the packaged sidecar's native deps (electron-builder drops a `node_modules` at the root of an extraResources copy — keep the staged server below the copy root); does not publish. `desktop:release` = manual fallback for the tag-triggered `release.yml` publish path (needs `GH_TOKEN`).
- `pnpm seed` — fill an **empty** storage root with demo data (use `--storage <dir>` to preview against a live storage root; admin password `demo`, labeled on the login page). Refuses existing libraries and packaged (`HOARDODILE_PACKAGED=1`) runtimes; dev-only tooling, not a product feature. `pnpm seed:screenshots` — isolated Fastify `:3010` + Vite `:5174`, writes PNGs to `tmp/demo-screenshots`.
- `pnpm -F @hoardodile/server reset` / `reset:dev` — remove admin password (web setup form reclaims the instance).
- `hoardodile plugin <create|build|run|bench|dev>` — plugin CLI; scaffold via `pnpm dlx create-hoardodile-plugin <name>`.

Server has no CLI flags; config from env vars validated in `apps/server/src/config/env.ts`.

## Coding guidelines

- Elegance beats brevity; no over-engineering or speculative abstractions. Deduplicate code; collapse functions with >4 parameters into a single options object.
- Prefer type inference; use type guards / assertion functions / `satisfies` instead of `as`. Avoid arrow functions assigned to `let`/`const`.
- React Compiler is enabled; plain-function component calls outside React render need `"use no memo"`.
- Check `DESIGN.md` before designing or reshaping any UI.
- Links outside the SPA must go through `ExternalLink` (`apps/web/src/components/common/ExternalLink.tsx` → `openExternalUrl`); bare `target="_blank"` anchors, literal external `href`s and stray `window.open` calls are blocked by `scripts/guard-external-links.mjs` (pre-commit). On desktop the shell additionally lets a same-origin navigation replace the app window only for SPA routes registered at boot (`registerAppRoutes`, patterns from `routeTree.gen.ts`); every other URL opens in the OS browser — see `apps/desktop/src/main/urls.ts`.
- Never edit non-ASCII files (i18n JSON, docs) via PowerShell `Get-Content`/`Set-Content` string replacement — the ANSI round-trip corrupts UTF-8. Use the edit tool, or `[System.IO.File]::ReadAllText`/`WriteAllText` at most.

## Dependencies

- Runtime deps live in the package that uses them; shared versions use `catalog:` in `pnpm-workspace.yaml`. Check existing deps first (`es-toolkit`, `dayjs` via `@hoardodile/shared/dayjs`).
- `apps/server` ships a production `node_modules` — runtime imports must be in `dependencies`.
- SDK closure (`@hoardodile/{ui,sdk-*}`) must not import outside itself (enforced by `sdks:pack`); terminal packages (`cli`, `host`, `host-web`, `workbench`) are never imported by plugin code. SSOT: `scripts/lib/sdk-closure.mjs` (closure = 5, release set = 9).
- SDK + `host` / `host-web` ship `src` alongside `dist` — never drop it from `files`; `@hoardodile/cli`, `workbench`, `create-plugin` are dist-only.
- Pinned: `@blocknote/*` 0.51.4 (plus `@handlewithcare/prosemirror-suggest-changes` 0.1.8) — the doc diff feature depends on BlockNote internals that 0.52+ removed; `@videojs/react` 10.0.0-beta.25 (gallery player prerelease, API churns between betas); the 10 tsup-built packages pin `typescript: 5.9.3` (do not bump them to catalog TypeScript 7). All of these are enforced by `scripts/guard-protected-deps.mjs` (pre-commit + CI) and excluded from `deps:update`; an intentional bump must follow the checklist in `apps/web/src/features/doc/README.md`.

## Project structure

```
apps/
  web/         React SPA (routes/, features/, components/, i18n/)
  server/      Fastify (domain/, infra/, config/)
packages/
  shared/      App-internal utils (incl. dayjs re-export)
  schemas/     App-internal Zod schemas (tables live in domain/*/schema.ts)
  ui/          Published shadcn/ui
  cli/         Developer CLI — hoardodile plugin build/run/bench/dev
plugins/
  sdk-{types,server,web,react}/  Plugin contract + authoring SDK + iframe runtime
  host/        App-side runtime host — sandbox, hooks, storage (src/hoard/ + src/media/)
  host-web/    Browser-side host runtime (protocol router, mock host)
  workbench/   Offline dev tool (`hoardodile plugin dev`)
  create-plugin/  Interactive scaffolder (embeds a copy of template/)
  file/        Built-in fallback plugin
  gallery/     Official preinstalled media gallery
  template/    Third-party plugin starting point
scripts/       Root dev/license/guard/version scripts
.agents/skills/  Repo-local agent skills
```

## Architecture

- **Domain-driven:** `schema.ts` → `repo.ts` → `service.ts` → `router.ts` (+ often Fastify `plugin.ts`); services are `create*Service(deps)` factories.
- **Plugins:** `manifest.json` + server `main.js` (`definePlugin()`) + sandboxed iframe client. Contract in `@hoardodile/sdk-types`; `plugins/host/src/hooks.ts` is the ONLY way to invoke plugin hooks; `apps/server/src/domain/plugin/` is a thin consumer. Authoring details: `plugins/template` + `packages/cli/README.md`.
- **Storage:** layout authority `createStoragePaths` in `plugins/host/src/hoard/paths.ts` (`writeVersioned`, staging, sanitize). Resource content is bare files under `versions/<v>/resources/<id>/data/`; metadata dotfiles (`.cover.*`, `.deleted`, `.order`) stay at the resource root. Live DB is `{STORAGE_ROOT}/app.sqlite`; `versions/<v>/` are frozen syncable partitions; `local/` is host-only (cache, trash, upload staging). `apps/server/src/infra/storage/` is thin (bootstrap, `stageViewCloneDb`, paths re-export).
- **Write safety:** writes under `versions/<v>/` go through `writeVersioned` targeting the latest version (enforced by `scripts/guard-versions.mjs` over `apps/server/src` + `plugins/host/src`, exempting the `hoard/` definition site; exemptions need `// write-guard-exempt`).
- **Tags:** identity = `(category, name)`, globally unique; logic in `domain/tag/` (dedupe.ts, merge.ts, rules.ts); search expands, rendering collapses via `tag/filter.ts` + `tag/collapse.ts`.
- **Sync:** per-device state snapshots in `domain/sync/` (never real sync software); reminders via pref `sync.remindDays`.
- **Privacy:** `apps/web/src/features/privacy/` — `performSignOut` in `privacySignOut.ts` is the only sign-out path; session TTL via `domain/auth/ttl.ts` (pref `auth.sessionIdleTimeoutSeconds`, env fallback 7 days).
- **Trace vs usage:** append-only `user_actions` in `domain/trace/` (services stay trace-agnostic via optional `onUserAction`); browsing exposure is a separate `domain/usage/` (`usage_sessions`) — do not mix.

## Testing

- Vitest at `src/**/*.test.{ts,tsx}` (server: node; web/plugins: jsdom); pure-logic web tests carry `@vitest-environment node`; bench runs manually: `pnpm -F @hoardodile/server test:bench`.
- E2E: Playwright (`apps/web/e2e/`), critical-path smoke only; prefer Vitest + Testing Library; select by `data-testid`/role.

## Generated files — never hand-edit

- `apps/web/src/routeTree.gen.ts`, `apps/web/public/licenses.json`, `apps/web/public/LICENSE`
- `apps/server/src/infra/db/migrations/`, `CHANGELOG.md`, `pnpm-lock.yaml`
- `plugins/create-plugin/src/sdk-deps.gen.ts` (`scripts/gen-sdk-deps.mjs`)
- `plugins/create-plugin/src/template/` — synced from `plugins/template`; edit the source template, not the embedded copy.

Drizzle migration pitfalls: split add+drop into two `db:generate` runs (no-TTY rename prompt); `ADD COLUMN` silently drops FK actions like `ON DELETE CASCADE` — verify the SQL.

## Commits & releases

- Conventional Commits (`type(scope): subject`; scope = workspace package name); one cohesive unit per commit.
- Lefthook: `commit-msg` verifies commit messages; `pre-commit` = lint-staged + `pnpm lint` + `version:check` + versioned-write guard. CI runs `turbo run test --concurrency=2`.
- **Before committing:** `pnpm format` → `pnpm lint` → `turbo run test --concurrency=2 --filter=<changed packages>`, all green — verification gates the commit, not the end of a session.
- **Never merge, rebase, push, or delete branches.**
- One app version owned by root `package.json`, synced by `pnpm release`; release flow = `pnpm release <version>` (bump/tag/push + **draft** GitHub Release, `GITHUB_TOKEN`) → `release.yml` on the tag publishes npm (10 packages, `NODE_AUTH_TOKEN`) + the Windows installer to that draft (`GH_TOKEN`) → a human publishes the draft (updater sees it then). Recover from a failed run via Re-run jobs, or `pnpm -r publish` / `pnpm -F @hoardodile/desktop package:publish`. Never re-run `pnpm release` for an already-tagged version; **never hand-edit a `version` field**.
- Pre-1.0: breaking changes allowed, but flag them to the user first.

## Guardrails

- No telemetry or external calls — the only authorized external request is the user-triggered update check (Settings → About). Desktop, when `autoUpdate` is on, may check and download GitHub Release artifacts while the tray is alive. Web stays click-to-check.
- No git mutations unless explicitly asked.
- **Ask the user before modifying AGENTS.md.**
