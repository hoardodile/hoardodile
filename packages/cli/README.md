# @hoardodile/cli

The hoardodile developer CLI — one command for building, testing and
benchmarking content plugins against the real host implementation:

```bash
hoardodile plugin create           # scaffold a new plugin (via create-hoardodile-plugin)
hoardodile plugin build            # build a plugin into dist/ (--watch to rebuild)
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

## Install

```bash
pnpm add -D @hoardodile/cli
```

## Licensing

MIT. Terminal dev tooling — not part of the SDK closure and never
imported by plugin code.
