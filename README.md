# Hoardodile

Hoardodile is a modern digital hoarding tool for self-hosted archivists. It lets you hoard and preview any kind of digital content — images, documents, videos, web pages, and more — in one private library.

[中文说明 →](./README.zh-CN.md)

## Features

- **Hoard any content** — extensible content plugins support different formats and media types.
- **Preview in place** — browse and preview resources directly from your library.
- **Self-hosted & private** — your data stays on your own storage, under your control.

## Quick Start

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
pnpm build
pnpm start # http://127.0.0.1:3000
```

Requires Node.js 24 and pnpm.

## Agent Skills

The `skills` CLI (open agent skills ecosystem) installs this repo's agent skills straight from GitHub:

```bash
npx skills add hoardodile/hoardodile@hd-plugin         # author content plugins
npx skills add hoardodile/hoardodile@hd-plugin-design  # plugin UI design system (@hoardodile/ui)
npx skills add hoardodile/hoardodile --list             # list all skills in this repo
```

- `hd-plugin` — author hoardodile content plugins: manifest, server hooks, iframe client, toolchain.
- `hd-plugin-design` — the plugin UI design system built on `@hoardodile/ui`.

## Contributions

Pull requests are not accepted at this time. Bug reports and feature ideas are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-3.0](LICENSE)
