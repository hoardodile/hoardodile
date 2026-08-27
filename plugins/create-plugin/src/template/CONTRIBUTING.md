# Contributing to this plugin

Thanks for contributing! This is a hoardodile content plugin — sections below
cover the dev loop, quality gates, and how releases and the marketplace work.

## Development setup

- Node.js ≥ 24, pnpm 11.
- Clone the repository, then:

```bash
pnpm install
pnpm build     # dist/ (client + server bundle + manifest)
pnpm dev       # watch-build + workbench at http://127.0.0.1:5199
pnpm test      # Vitest unit tests against the fixture API
```

`pnpm exec hoardodile plugin run detect testdata --plugin-dir dist` runs the
detect hook through the same sandboxed worker the server uses.

## Code style

- TypeScript strict (`pnpm lint` = `tsc --noEmit`); no `any` without a comment.
- Prefer type guards and `satisfies` over `as`.
- Keep the plugin's own logic in `src/`; `manifest.json` at the repo root is
  the single source of truth for the plugin's identity, permissions and UI
  preferences.
- Add tests next to the code they cover; keep the fixture API usage minimal.

## Releases

Bump `version` in `manifest.json` on user-visible changes, then:

```bash
git tag v<version> && git push origin v<version>
```

The tag must match `v<manifest.version>` — `.github/workflows/release.yml`
builds, runs `hoardodile plugin package` (`release/<id>-<version>.zip` +
`.sha256`) and publishes the GitHub release. Your version is independent of
the hoardodile app version.

## Marketplace publishing

1. Add the repository address to your registry repo's `registry.json`.
2. Ship `intro.<locale>.md` files (see the README) so each release carries a
   version-pinned introduction the app can show.

## Issues and pull requests

- Bug reports and feature requests go through the issue templates
  (**New issue** → bug report / feature request).
- Pull requests should stay focused: one cohesive change, a matching test,
  and a description of the user-visible behavior.
- Security issues are **not** filed as public issues — see `SECURITY.md`.
