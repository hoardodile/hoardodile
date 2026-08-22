# @hoardodile/host

The plugin runtime host: worker-thread sandbox (spawned via the package's
own `worker-entry` subpath), hook strategy, resource containers, probe
cache, capability guard, and settings store. Consumed by the app server
and by the developer CLI (`@hoardodile/cli`) — `hooks.ts` is the only
way to invoke plugin hooks.

> **Not a plugin SDK package.** This is the app-side runtime: the
> authoring surface (`definePlugin`, `ResourceAPI`, fixtures) lives in
> `@hoardodile/sdk-types` and is re-exported by `@hoardodile/sdk-server`;
> everything else here (loader, discovery, sandbox, containers) exists
> for the app server and the CLI. Plugin code imports `@hoardodile/sdk-server`
> — except `runPluginHook`, which plugins consume from this package as a
> devDependency for Layer-2 tests (never shipped in a plugin bundle).

## Install

```bash
pnpm add @hoardodile/host
```

The content sniffer and the image/video/audio probes (`sniffBytes`,
`probeImageSource`, `probeAvMedia`, ...) load `sharp` and the
`ffmpeg-static` / `@derhuerst/ffprobe-static` binaries lazily at runtime;
`sharp` is an optional peer, the binaries are optional dependencies and
install automatically (skip with `--no-optional`; the loaders fall back
to PATH).

## Subpaths

| Entry | Contents |
| ----- | -------- |
| `@hoardodile/host` | Full runtime surface: loader, activation, discovery, sandbox, hook strategy, ResourceAPI builders, containers, probes, `runPluginHook` |
| `@hoardodile/host/probe` | Reusable probe implementations (image/video/audio metadata, animation detection) |
| `@hoardodile/host/contract` | The plugin contract vitest suite — validates a `PluginDefinition` against the real host. `vitest` is an optional peer |
| `@hoardodile/host/worker-entry` | Sandbox worker entry; resolves from any bundle |

## CLI

The developer CLI lives in `@hoardodile/cli`:

```bash
hoardodile plugin run <hook> <data-dir> --plugin-dir dist
hoardodile plugin bench <hook> <data-dir> --plugin-dir dist --compare baseline.json
hoardodile plugin dev   # watch-build + workbench at http://127.0.0.1:5199
```

`run`/`bench` execute hooks through this package's worker sandbox — what
you test is what runs in production. `bench` writes JSON reports (with
machine fingerprint, peak RSS and warmup count); `--compare` exits 1 on
regression and warns on cross-machine baselines.

## Licensing

MIT. This package is the terminal runtime (consumed by the GPL-3.0 app
server and by plugin dev tooling); it is not part of the SDK closure and
plugin code never links it.

## Docs

- [Plugin development](https://docs.hoardodile.com/plugin-development/)
- [Plugins overview](https://docs.hoardodile.com/plugins/)
