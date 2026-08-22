# @hoardodile/host-web

The browser-side plugin host runtime: the shared host-core protocol
router (used by the hoardodile web app in production and by the offline
mock) plus the mock host for component tests and the workbench. The wire
protocol itself stays in `@hoardodile/sdk-web` — this package consumes
it, never redefines it.

## Install

```bash
pnpm add @hoardodile/host-web
```

## What's in it

- **`createHostRouter`** / **`defineHandler`** — the host-core protocol
  router: message demux, method routing, per-method param validation,
  stale-request scoping, response envelope. The real app and the mock
  assemble on this module so routing and validation never drift
- **`createMockHost`** — an in-memory host for jsdom component tests and
  the workbench; register a window and drive the iframe bridge with no
  server
- **`createInMemoryFileBackend`** — file backend for the mock

## Subpaths

| Entry | Contents |
| ----- | -------- |
| `@hoardodile/host-web` | Browser-safe router + mock (no node imports) |
| `@hoardodile/host-web/node` | Node file backends (directory-backed mock storage) |

## Docs

- [Plugin development](https://docs.hoardodile.com/plugin-development/)
