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
tag-triggered workflow (`plugins/template/.github/workflows/release.yml`)
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
once (built-in default: `hoardodile/marketplace`) and reads everything
else — each plugin's manifest (name, description, icon, permissions) via
`raw.githubusercontent.com`, and its latest release (version, notes, zip
asset, optional `.sha256` sidecar) via `api.github.com`. Requirements:

- all repos are **public** (raw reads and unauthenticated API calls);
- release tags follow `v<version>` (a `v` prefix is tolerated);
- the zip asset is what `plugin package` produces (`<id>-<version>.zip`,
  or any `*.zip` in the release).

The unauthenticated GitHub API budget is 60 requests/hour per IP; one
marketplace refresh costs one request per plugin (registry + manifests
skip the API entirely), and the app caches snapshots for 10 minutes.
All these fetches go through the app's user proxy when one is
configured (auto-detected from the proxy env vars / OS system proxy;
`HOARDODILE_PROXY` overrides) — destinations stay GitHub-only.

## Install

```bash
pnpm add -D @hoardodile/cli
```

## Licensing

MIT. Terminal dev tooling — not part of the SDK closure and never
imported by plugin code.
