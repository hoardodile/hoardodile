# @hoardodile/cli

The hoardodile developer CLI — one command for building, testing and
benchmarking content plugins against the real host implementation:

```bash
hoardodile plugin create           # scaffold a new plugin (via create-hoardodile-plugin)
hoardodile plugin build            # build a plugin into dist/ (--watch to rebuild)
hoardodile plugin package          # build + zip dist/ into release/<id>-<version>.zip
hoardodile plugin run detect .     # run a hook through the capability sandbox
hoardodile plugin bench detect .   # measure hook latency, compare vs a baseline
hoardodile plugin dev              # watch-build + workbench at http://127.0.0.1:5199
```

`run`/`bench` execute hooks through `@hoardodile/host`'s capability
sandbox (restricted child process + module policy), hook strategy and
real probe implementations — the exact execution path
the server uses — so what you test is what runs in production.
`bench` writes JSON reports (machine fingerprint, peak RSS, warmup
count); `--warmup N` tunes the discarded warmup runs, `--compare`
exits 1 on regression and warns when the baseline came from another
machine.

`hoardodile plugin create` is a facade over
`create-hoardodile-plugin` (which stays a separate package for npm's
`create-*` convention): it runs the scaffolder via `pnpm dlx` and
forwards `<name>` / `--tarballs <dir>`.

## Marketplace publishing

`plugin package` zips the **contents** of `dist/` — `manifest.json` at
the zip root, exactly what the app's installer expects — into
`release/<id>-<version>.zip` plus a `<zip>.sha256` sidecar, and prints
the registry line to add to your registry repo:

```bash
hoardodile plugin package
# → <id> v<version> → ./release/<id>-<version>.zip
# → checksum:      ./release/<id>-<version>.zip.sha256
# → registry line: "https://github.com/<owner>/<repo>"
# → publish:       push a tag v<version> — the release workflow
#                  (plugins/template/.github/workflows/release.yml) builds and publishes
```

(Use `--skip-build` to package the existing `dist/` without rebuilding.)

The plugin archive channel is zip-only: the app's installer (zip upload
and marketplace install) rejects any other archive format, so `plugin
package` always produces the zip the server expects.

Publishing is a CI concern, not a local one: the plugin template ships a
tag-triggered workflow ([`plugins/template/.github/workflows/release.yml`](../../plugins/template/.github/workflows/release.yml))
that runs `pnpm build` + `plugin package` and uploads both artifacts as
the GitHub release for the tag. All you need is a pushed tag matching
`v<manifest.version>` — no `gh` CLI, no token.

Then add the line to the `plugins` array of your registry repo's
`registry.json`:

```json
{
  "version": 1,
  "plugins": [
    "https://github.com/<owner>/<repo>"
  ]
}
```

The app's **Settings → Marketplace** takes the registry repo address
once (built-in default: [`hoardodile/marketplace`](https://github.com/hoardodile/marketplace)) and reads everything
else — each plugin's manifest (name, description, icon, permissions) via
`raw.githubusercontent.com`, the latest release (version + published
date + notes) via the free `releases.atom` feed, and on demand the
installable payload (zip asset, optional `.sha256` sidecar, per-locale
readme) from `github.com/<repo>/releases/expanded_assets/<tag>`. All these
channels are quota-free GitHub web endpoints — the marketplace never
touches `api.github.com`, so a shared IP with an exhausted API quota
cannot block it. Requirements:

- all repos are **public** (raw reads and unauthenticated web-channel
  fetches);
- release tags follow `v<version>` (a `v` prefix is tolerated);
- the zip asset is what `plugin package` produces (`<id>-<version>.zip`,
  or any `*.zip` in the release).

The server caches the catalog snapshot in memory (default 24 h) and the
per-repo release payload on disk (`local/cache/marketplace-releases.json`,
default 24 h), so the endpoints are asked at most once per repo per day.
All these fetches go through the app's user proxy when one is
configured (auto-detected from the proxy env vars / OS system proxy;
`HOARDODILE_PROXY` overrides) — destinations stay GitHub-only.

## plugin dev

`plugin dev` watch-builds the plugin and serves it at
`http://127.0.0.1:5199` (rebinds to the next free port if taken). Data
comes from one of three sources:

- `--data <dir>` — one resource: the directory itself.
- `--storage <root>` — a real hoardodile library, opened **read-only**.
- `--resource-dir <dir>` — a folder whose direct subfolders are the
  individual resources (a many-item `testdata/`), switchable in the
  workbench resource list. Mutually exclusive with `--data`/`--storage`.

With any option omitted, `<plugin-dir>/testdata` is used when it exists.
`--res <id>` opens a specific resource first when serving `--storage`.

## Install

```bash
pnpm add -D @hoardodile/cli
```

## Licensing

MIT. Terminal dev tooling — not part of the SDK closure and never
imported by plugin code.
