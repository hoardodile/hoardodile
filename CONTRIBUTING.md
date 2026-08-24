# Contributing

Thanks for your interest in hoardodile. Please read this before opening anything.

## Pull requests are currently closed

Code contributions via pull requests are **not accepted at this time** — pull requests will be closed without review. This may change in the future; if it does, this file and the issue templates will be updated first.

Nothing below waits for that to change: bug reports, use-case discussions, and security reports are welcome today.

## Where to report

| You want to... | Go to |
|---|---|
| Report a defect | Bug Report issue template |
| Suggest a use case or feature idea | Feature Request issue template (use-case discussion only — not a promise to implement) |
| Ask a usage, setup, or deployment question | GitHub Discussions |
| Report a security vulnerability | [SECURITY.md](SECURITY.md) — private advisory, never a public issue |

Empty issues are disabled — pick the matching template instead.

Bug reports should include the hoardodile version or commit, your operating system, steps to reproduce, expected behavior, and actual behavior plus logs with anything private redacted. **Never paste content from your library or its URLs.**

## Local setup

Prerequisites: Node.js 24 and pnpm (via corepack).

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
```

Common commands:

- `pnpm dev` — web (Vite HMR) + backend + plugin watchers
- `pnpm build` — full build (plugins, web, server)
- `pnpm lint` — biome + tsc
- `pnpm format` — auto-format
- `turbo run test --concurrency=2 --filter=<package>` — tests for a changed package (e.g. `@hoardodile/web`)
- `pnpm seed` — fill an **empty** storage root with demo data (admin password `demo`)

## Guidance

- Before designing or reshaping any UI, check [DESIGN.md](DESIGN.md).
- Writes under `versions/<v>/` must go through `writeVersioned` (enforced by a pre-commit guard).
- Terminal packages (`cli`, `host`, `host-web`, `workbench`) are never imported by plugin code.
- Generated files — `routeTree.gen.ts`, migrations, `pnpm-lock.yaml`, `CHANGELOG.md`, embedded plugin templates — are never hand-edited.
- Further conventions live in [AGENTS.md](AGENTS.md).

## License

By contributing, you agree that your contributions are licensed under the [GPL-3.0](LICENSE).
