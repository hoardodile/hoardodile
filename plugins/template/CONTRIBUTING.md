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

- Run `pnpm format` (biome) then `pnpm lint` (`biome check .` + `tsc --noEmit`,
  TypeScript strict) before committing; no `any` without a comment.
- Prefer type guards and `satisfies` over `as`.
- Keep the plugin's own logic in `src/`; `manifest.json` at the repo root is
  the single source of truth for the plugin's identity, permissions and UI
  preferences.
- Add tests next to the code they cover; keep the fixture API usage minimal.

## Git hooks

`lefthook.yml` is installed by `pnpm postinstall` when the repo has a `.git`,
or on demand with `lefthook install`. `commit-msg` enforces Conventional
Commits (the format `pnpm release` uses to write `CHANGELOG.md`), and
`pre-commit` runs `pnpm lint-staged` (biome on staged files) + `pnpm lint`.
`AGENTS.md` follows the repo's casing convention (uppercase).

## Releases

Bump `version` in `manifest.json` on user-visible changes, then release with
one command:

```bash
pnpm release <version>
```

release-it bumps `package.json` **and** `manifest.json` (kept in lockstep by
`scripts/sync-version.mjs`), writes `CHANGELOG.md` from Conventional Commits,
commits `chore(release): v<version>`, tags and pushes. Run it on `main` with a
clean working tree. `.github/workflows/release.yml` then builds, runs
`hoardodile plugin package` (`release/<id>-<version>.zip` + `.sha256`) and
publishes the GitHub release. The tag must match `v<manifest.version>` — the
workflow fails otherwise. Your version is independent of the hoardodile app
version.

Pushing the tag by hand still works as a fallback:
`git tag v<version> && git push origin v<version>`.

## Marketplace publishing

1. Add the repository address to your registry repo's `registry.json`.
2. Ship a `README.md` fallback plus `README.<locale>.md` files (see the
   README) so each release carries a version-pinned readme the app can show.

## Issues and pull requests

- Bug reports and feature requests go through the issue templates
  (**New issue** → bug report / feature request).
- Pull requests should stay focused: one cohesive change, a matching test,
  and a description of the user-visible behavior.
- Security issues are **not** filed as public issues — see `SECURITY.md`.
