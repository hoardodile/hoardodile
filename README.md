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

## Deploy with Docker

```bash
docker compose up -d   # http://localhost:3000
```

- Data lives in the named volume `hoardodile-data` (mounted at `/data`); `docker compose down -v` **deletes it** — bind-mount `./data:/data` instead if you prefer an inspectable directory. The image runs as a non-root user and declares a HEALTHCHECK (`docker compose ps` shows the state).
- Upgrade = rebuild/re-pull the image and `docker compose up -d`; migrations run on next start. The bundled gallery/pdf plugins are seeds: uninstalling one removes it for the container's lifetime, and a newer image re-ships it (same semantics as desktop app updates).
- Behind a TLS reverse proxy set `FORCE_HTTPS=true` and drop `SESSION_SECURE_COOKIE=false` from `environment`. `HOST`/`PORT`/`STORAGE_ROOT` are configurable; see `.env.example` for the full env surface. The `pnpm seed` demo tool refuses to run inside the image (it is dev-only tooling).
- Custom plugins: mount your plugin zip/dir under `/app/plugins/<slug>` (never overwrite the bundled seeds) and install it in the UI; a newer image re-ships the bundled plugins as before. To distribute your own plugins, publish GitHub releases and point **Settings → Marketplace** at a registry repo — see `packages/cli/README.md`.

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
