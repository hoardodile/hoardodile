# Hoardodile Desktop

Thin cross-platform Electron shell around the existing Fastify app. The shell MUST do as little as possible: Fastify, Drizzle, plugins, native addons, and media binaries stay on a real Node 24 sidecar. Electron owns tray, one window, the first-run wizard, env injection, graceful stop, and the updater. UI tokens, palettes, and layout live in `DESIGN.md`.

Release matrix: **Windows x64** (NSIS + portable zip), **Linux x64** (AppImage), **macOS arm64** (dmg + zip). macOS x64 and signing/notarization are future work.

## Process model

```mermaid
sequenceDiagram
  participant Main as ElectronMain
  participant Wizard as WizardPage
  participant Child as NodeSidecar
  participant BW as BrowserWindow
  Main->>Main: read desktop.json
  alt first run
    Main->>Wizard: load wizard
    Wizard->>Main: library autostart startInTray
    Main->>Main: write desktop.json
  end
  Main->>Child: spawn node with absolute env
  Main->>Child: poll GET /health
  alt startInTray or hidden
    Main->>Main: tray only
  else open window
    Main->>BW: loadURL http://127.0.0.1:port
  end
```

| Process | Owns |
| --- | --- |
| Electron main | Tray, window factory, wizard, updater, env, graceful stop, single-instance lock, `setWindowOpenHandler` |
| Node 24 sidecar | HTTP, tRPC, SQLite, plugins, thumbs, migrations — spawned from `extraResources/node/`, never `process.execPath` |
| Chromium renderer | Existing SPA (and the wizard page before the sidecar exists); preload is a bridge, not an application layer |

First run runs the wizard (library folder, start with Windows, start in tray) before the sidecar exists. The sidecar is then spawned with a complete absolute env and polled via `GET /health` (`{ ok: true }` — never `/api/health`); the window loads `http://127.0.0.1:<port>/`.

The renderer is disposable: closing the window destroys the `BrowserWindow` (never hides it) and does NOT stop the sidecar, plugin workers, or ffmpeg. Tray Open creates a new window onto the already-listening URL; the Electron session persists under `userData` so reopening does not force a new login. A sidecar crash surfaces in the tray with a restart action and never quits the shell by itself. Quit is tray-only (graceful sidecar stop, then `app.quit()`). A second launch focuses the existing instance; autostart passes a hidden switch so login-item launches don't flash a window when `startInTray` is set.

## Config

`desktop.json` in Electron `userData` (never under `STORAGE_ROOT`): `wizardComplete`, `libraryPath`, `sharedFolderRoot`, `sharedFolderEnabled`, `port`, `lanEnabled`, `autoStart`, `startInTray`, `autoUpdate`, `resourceVersion` (applied resource-payload version when it differs from the shell's). Defaults: `Documents/hoardodile`, `Documents`, off, 3000, off, off, off, on **except macOS** (`autoUpdate` defaults off: unsigned builds cannot verify an update, so macOS auto-update is off until signed & notarized builds exist — Settings still runs click-to-check). The wizard collects only library folder, autostart, and start-in-tray — never the admin password or a port.

The shell prefers the persisted `port`, falls back through `get-port`, and writes back the port that actually bound; the port MUST stick across restarts (session cookies are `sameSite: strict`, keyed by host+port). Changing the library relaunches the app (the shell never copies or moves files). Changing the shared folder live-patches the sidecar via `POST /api/internal/shared-folder` (or `{ "path": null }` to disable) without relaunching; the wizard must not turn the switch on.

## Spawn env

With `HOARDODILE_PACKAGED=1` the server skips workspace `.env` loading and the shell injects a complete env, every path absolute: `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT` (persisted, then `get-port`), `STORAGE_ROOT` (libraryPath), `BUILTIN_PATH` (packaged `plugins/file`), `SEED_PLUGIN_PATHS` (every bundled seed plugin the shell discovers in `plugins/` at spawn — anything with a `manifest.json` except the builtin `file`), `DISABLE_DEV_PLUGINS=true`, optional `SHARED_FOLDER_ROOT` when enabled, `HOARDODILE_SHUTDOWN_TOKEN` (per-spawn secret), `SESSION_SECURE_COOKIE=false`, `FORCE_HTTPS=false`. `APP_WEB_ROOT` stays unset so the sidecar serves `server/web` from its own dist tree. If Fastify binds a different port than requested, persist it and load it — the `/health` probe on the intended port is enough; don't parse logs.

## Renderer bridge

`contextIsolation`, `sandbox`, `nodeIntegration: false`; folder picks run in main via `dialog`. `window.hoardodileDesktop` exists only in the desktop renderer (wizard and SPA); browser tabs see `undefined`. The bridge exposes `isDesktop`, `platform: "desktop"`, minimize / toggleMaximize / close / isMaximized (+ maximize subscription), `updates` (status, check, progress, `quitAndInstall`), `pickLibraryFolder`, `relaunch`, `setSharedFolderRoot`, `setSharedFolderEnabled`, `setCloseAction`, `openExternal`, `registerAppRoutes`. Caption close follows the persisted close action (`ask` / `tray` / `quit`, editable in Settings; the ask dialog remembers the choice); a caption or taskbar close on the app window routes through the same guard.

## Navigation policy

The app window must never be navigated away from the SPA. The shell's `setWindowOpenHandler` / `will-navigate` policy (`src/main/urls.ts`) keeps a navigation in the window only when it stays on the app origin (loopback `localhost` ⇔ `127.0.0.1` for the same port) **and** its pathname matches one of the SPA's registered route patterns; every other http(s) URL goes to `shell.openExternal` (OS browser) and non-http schemes are dropped. `app` window `window.open` is always denied and re-routed through the same decision. The SPA registers its routes (`fullPath` patterns from `routeTree.gen.ts`) once at boot via `registerAppRoutes` (`desktop:app:routes`), so new routes extend the allowlist automatically and the shell never hard-codes them. Wizard windows keep the historical loopback rule (no links there). Web-side, non-SPA links must go through `ExternalLink` (`apps/web/src/components/common/ExternalLink.tsx`), which calls `openExternal`; the shell policy is the backstop for anything that bypasses it (JS navigation). The policy follows the current frame origin, so a sidecar port change after reload needs no shell state.

## Caption bar

One shared control (prefer `@hoardodile/ui`) used by `AppShell` on the SPA and by the wizard page; details (height `h-nav`, history buttons, Windows caption buttons, drag region, double-click maximize) live in `DESIGN.md`. Shown only when the bridge is present. Accepted gap: no Win11 snap-layout flyout; edge snapping must still work, and the window must not be transparent.

## Packaging

electron-builder, one target per release platform: Windows x64 (NSIS installer plus optional portable zip), Linux x64 (AppImage), macOS arm64 (dmg + zip — the zip is the electron-updater update artifact). The sidecar unit is the whole `apps/server/dist` tree built so the SPA is inside it — never separately stage `apps/web/dist`:

```
extraResources/
  node/       node.exe (win: the runner's official Node) / node (linux+mac:
              pinned nodejs.org dist, sha256-verified, ad-hoc signed on
              macOS — see scripts/lib/node-dist.mjs)
  server/     apps/server/dist, spawned as `node server/main.js`
  plugins/    builtin `file` + every seed plugin dist (discovered by
              scripts/lib/plugin-channels.mjs, never a hardcoded list)
```

The runtime tree assembly is shared with the Docker image (`scripts/stage-runtime.mjs`); `apps/desktop/scripts/stage-resources.mjs` adds the Node runtime, icons and the `resources-version.json` marker. `package:dir` produces the unpacked build used by the Playwright launch smoke; `package:linux`/`package:mac` (and their `package:publish:` variants) run the full artifact + feed chain through `verify-package` → `verify-resources-pack` (all platforms; the win job additionally uploads the pack to the draft) → `verify-feed`. Always invoke electron-builder through the pnpm scripts — a bare `node node_modules/electron-builder/cli.js` can fall back to npm mode and crawl the pnpm store (minutes-long, pathological).

Shell JS may live in asar; nothing the sidecar reads may (server dist, plugin dists). Prune tests, docs, extra Electron locales, PDBs; keep ffmpeg, ffprobe, 7z, sharp, seed plugin dists, and server `.map` files. ffmpeg/ffprobe/7z resolve from the copied `server/node_modules` via `createRequire` — the shell must not inject `FFMPEG_PATH` / `FFPROBE_PATH` / `7Z_BIN_PATH`. `SEED_PLUGIN_PATHS` (the bundled seed plugins) seeds those plugins into `{storage}/versions/<latest>/plugins` when the on-disk tree differs, so they behave like installed plugins; app updates refresh them on the current version only. Uninstalling one on desktop removes the bundled seed source too, so it stays gone until the app is updated (which re-ships the package). User data never goes in `extraResources`; DB migrations run against `STORAGE_ROOT` on next start. App version is the root `package.json`; never hand-edit a `version` field.

## Updates

electron-updater against GitHub Releases (per-platform feed: `latest.yml`, `latest-linux.yml`, `latest-mac.yml`) plus the **resource-pack channel**: on Windows NSIS installs, a release that leaves the shell and Electron runtime byte-identical is delivered as a LAYERED payload (`resources-pack-<platform>-<arch>.json` + one tarball per layer: `node` with runtime bumps, `server-dist` ~5 MB for typical code releases, `server-node_modules` with dependency bumps, `plugins`) and applied in place — graceful sidecar stop → atomic swap inside `resources/` → restart, with the window, data and session preserved. The shell hashes its own `out/` bundle (content hash, see `src/main/shell-hash.ts` vs `scripts/lib/shell-hash.mjs`) and compares it plus `process.versions.electron` against the pack manifest (built by `scripts/build-resources-pack.mjs`, verified by `scripts/verify-resources-pack.mjs`); any mismatch means the full installer path. Each layer carries its own content identity; unchanged layers are copied from the installed tree into the staging swap, so a typical release downloads only `server-dist`. Artifacts are fetched by stable name via `https://github.com/hoardodile/hoardodile/releases/latest/download/…` (no API, no token; drafts stay invisible, so the human review gate applies unchanged) and sha256-verified before anything is swapped. Where the resources dir is not a writable `resources/` tree (portable zip, AppImage, signed bundles, dev), the channel stays off and updates behave exactly as before. The channel policy lives in one table per side: `scripts/lib/resource-pack-targets.mjs` (build) and `src/main/resource-support.ts` (runtime).

State machine (`DesktopUpdateState`): `idle → checking → downloading → ready → apply (resources, sidecar restart only) | quitAndInstall (full)`, with an `applying` status carrying `stopping/swapping/starting` phases while the resource swap runs. `autoDownload/autoUpdate` governs both channels; no update applies without a confirmation — never restart while a window is using the library without confirmation. Portable builds link to GitHub from About; no `quitAndInstall`, no resource channel. Unsigned self-builds must not require publisher signature verification; signed official releases must verify. Desktop stays click-to-check on web, one brain: preload `desktop.updates` (same GitHub artifacts).

Crash-safety contract: every failure path leaves either the previous tree or the fully swapped tree — never an intermediate state (`src/main/resources-swap.ts`: `.swap-pending` marker written first, `.olds/` backup, four-state boot recovery). If the new sidecar never reaches `/health`, the swap is rolled back (a killed migration is transactional, so the DB stays on the old schema); once it has been healthy, no auto-rollback happens (the DB may already host the new schema — same as a full update).

**Release rule for the resource channel**: a resource pack must keep the server usable with every shell that ships its hash — the pack carries no Electron code, so anything that changes the env the shell passes to the sidecar (or the shell's spawn contract) must ship in the same release as a shell/Electron change, which is exactly what forces the full-update path.

## Release gates

What turns "the CI job passed" into "we ship this": the tag-triggered `release.yml` builds, uploads and self-checks per platform (`stage-resources` → electron-builder `--publish always` → `verify-package` (natives + sandbox probe) → `verify-feed`), then a **human publishes the draft** — electron-updater does not see draft releases, so the draft is the review gate.

**Launch smoke is automated** — `desktop.yml` runs the Playwright e2e suite against the packaged unpacked app on every affected PR and on every tag (Windows/Linux/macOS): wizard → sidecar `/health` → first-run claim → sidebar, plus a relaunch persistence check. The manual gates below are the pieces CI cannot do on a clean machine before publishing that draft; they are the release checklist, not optional extras.

1. **Launch smoke (manual re-check on a pre-1.0 clean machine)** — install the artifact: wizard → sidecar `/health` → login → import one resource → About shows `<version>`. CI's automated smoke covers the boot path; the manual pass also exercises installers (NSIS / dmg / AppImage) and the OS integration around them.
2. **Upgrade smoke** — install the previous release artifact, create a library and import something, then Settings → About → check for updates → update → restart → login, library intact, About shows `<version>`.
3. **Draft review** — GitHub Releases page: CHANGELOG body sane, attachments present (installer/portable zip/blockmap/`latest.yml` per platform, dmg+`latest-mac.yml`, AppImage+`latest-linux.yml`, plus the Windows resource pack: `resources-pack-win-x64.json` and its four `resources-layer-win-x64-*.tar.gz` archives), no leftover `0.0.0` artifacts.
4. **Manual resource-channel smoke (Windows, pre-1.0 clean machine)** — with the previous release installed and a library with one imported resource: build a tag that changes only `apps/server` code → Settings → About → check for updates → only a "resources" update appears (a ~5 MB layer download, no installer) → apply → window stays open, no re-login, data intact, About shows the `Resources vX` chip. Then break the network: the check reports failure and the app keeps working. The same path is automated in `e2e/resources-update.spec.ts` against a local fixture feed (`HOARDODILE_RESOURCE_FEED_BASE` + `build-resources-pack --version` are test-only hooks; the CI chain never sets them).

v0.1 installers are **unsigned everywhere**: Windows SmartScreen warns "unknown publisher" (`verifyUpdateCodeSignature: false` stays until a certificate is wired in via `CSC_LINK`/`CSC_KEY_PASSWORD`), macOS shows Gatekeeper prompts (ad-hoc signed; `autoUpdate` stays off until signed & notarized builds), Linux AppImage needs no signature; release notes must say so.

## Shutdown

`child.kill()` force-terminates and skips the SIGTERM handler, leaving SQLite WAL locks. The sidecar must expose token-gated `POST /api/internal/shutdown` (loopback only; wrong token → 401, no close). The shell POSTs shutdown, waits for exit, then `child.kill()` on timeout — same sequence for tray Quit and before `quitAndInstall()`.

## Security and privacy

- `HOST=127.0.0.1` by default; local-network binding is an authenticated Settings toggle (same port, `0.0.0.0`) that requires an admin password and is never offered by the wizard; a weak password needs an explicit in-app confirmation before enabling.
- `/api/internal/*` control routes are loopback-gated: non-loopback peers get 403 even with a valid token. A browser on the same machine may open the same URL; cookies are not shared with Electron.
- Production desktop never registers `/sw.js` (a SW on `http://127.0.0.1` stale-caches across installer updates) and unregisters any existing controller.
- Folder picker in main, not the renderer; shutdown is token-gated; external https via `openExternal`.

## Dev

`pnpm dev` (browser tab) and `pnpm desktop` (Electron) are independent — `pnpm desktop` never requires `pnpm dev` to be running. Desktop loads the Vite URL so HMR works; when nothing answers there, the shell window shows its own Retry page (caption bar intact) and you can start `pnpm dev` and press Retry inside the window. A main-frame response with an error status (e.g. the proxy's 502 when a target is down) also swaps in that error page — a raw failure body is never shown. The desktop never uses the dev Fastify: main registers `session.protocol.handle("http")` to forward SPA-origin `/trpc`, `/auth`, `/api`, `/health` to the sidecar (`dest-api-proxy.ts`); `/api/internal` is never forwarded, and a sidecar restart only updates the target origin. Production windows load the Fastify-served SPA from the sidecar `server/web` tree (no proxy). The wizard has its own small Vite.

DevTools is not auto-opened; dev runs show a toggle button on the caption bar (left of minimize) that docks it on the right, and the window keeps the dock-width reservation so the app still renders at 1440px next to the panel.

`apps/desktop/scripts/dev.mjs` never starts or owns the SPA and does not wait for one. It resolves the SPA URL (ports live in `scripts/lib/dev-ports.json` — change them there, never in consumers) from `HOARDODILE_WEB_URL` or the default, starts the wizard on the first free port at or above its default (bound to `127.0.0.1`), one-shot builds main + preload, and spawns Electron with `HOARDODILE_WEB_URL` / `ELECTRON_WIZARD_URL` / `HOARDODILE_WORKSPACE`; the sidecar is spawned by the shell (vite-node on `apps/server` source), so no backend or plugin watchers from `pnpm dev` are needed, and the SPA's `VITE_SERVER_URL` proxy target is never touched. Ctrl+C closes the wizard server and tree-kills Electron so the sidecar does not linger.

## E2E (Playwright launch smoke)

`pnpm -F @hoardodile/desktop package:dir` (stage + electron-builder `--dir` + `verify-package`) builds the unpacked app, then `pnpm -F @hoardodile/desktop test:e2e` drives it like a real user on the current OS (Linux CI under `xvfb-run -a`; Windows/Linux/macOS in CI). The harness (`e2e/launch.ts`) launches the packaged binary with a throwaway `--user-data-dir` and `HOARDODILE_E2E=1` (shell skips tray + updater), pins `Documents` via `HOARDODILE_E2E_DOCUMENTS` so the wizard default is deterministic, and passes `--no-sandbox` on Linux; `DESKTOP_E2E_EXECUTABLE` overrides the binary path. Both env hooks and the `--user-data-dir` argument are test-only (see `src/main/index.ts`).

## Porting notes

The same shell / sidecar / renderer split holds on all platforms; only packaging and OS chrome differ (tray vs menu bar, caption buttons). Windows-only assumptions that were removed: `isPortableBuild` (updater — a Windows zip concept), the updater cache base (now `app.getPath("cache")` on macOS/Linux), and the staged Node runtime (pinned official dist per platform). Remaining gaps: macOS caption buttons are still the custom HTML bar (`frame: false`), macOS is unsigned/not notarized, macOS x64 needs cross-arch optional-dependency staging (`pnpm --config.platform/--config.arch`) on an arm64 runner.
