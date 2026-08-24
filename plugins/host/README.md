# @hoardodile/host

The plugin runtime host: capability sandbox (one restricted child process
per plugin, spawned via the package's own `worker-entry` subpath), hook
strategy, resource containers, probe cache, capability guard, and settings
store. Consumed by the app server and by the developer CLI
(`@hoardodile/cli`) — `hooks.ts` is the only way to invoke plugin hooks.

**Sandbox boundary.** Each plugin's `main.js` runs in a forked child
process under Node's permission model (fs read limited to the plugin's
own directory, no fs write, no child processes, no worker threads, no
native addons) plus a module policy hook (registered in the entry via
`module.registerHooks`, synchronous and main-thread — no additional grants
needed) that denies every module outside the plugin directory and every
`node:` builtin except `node:url`, a scrubbed global surface
(`fetch`/`WebSocket`/`EventSource` throw, `process.env` is empty), and a
startup self-check that refuses to run when the permission model or the
module policy is not active. The only privileged interface left is the
`ResourceAPI` RPC: paths are resource-relative and every call executes
host-side. The sandbox is a capability boundary against plugin code (fault
isolation: watchdog, hard timeout, memory cap, respawn budget), not an
OS-level sandbox — plugins still share the server's OS user.

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
| `@hoardodile/host/worker-entry` | Sandbox child-process entry (`worker-entry.mjs`, module policy inline); resolves from any bundle |

## CLI

The developer CLI lives in `@hoardodile/cli`:

```bash
hoardodile plugin run <hook> <data-dir> --plugin-dir dist
hoardodile plugin bench <hook> <data-dir> --plugin-dir dist --compare baseline.json
hoardodile plugin dev   # watch-build + workbench at http://127.0.0.1:5199
```

`run`/`bench` execute hooks through this package's sandbox — what
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
