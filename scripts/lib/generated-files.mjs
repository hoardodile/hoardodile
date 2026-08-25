/**
 * Canonical list of the committed generated artifacts the web build may
 * rewrite. `scripts/check-generated-files.mjs` diffs these (CI); each entry
 * names how to regenerate it, so a drift message is actionable.
 *
 * `apps/web/src/routeTree.gen.ts` is deliberately NOT here: it is a pure
 * build input (imported by main.tsx, the test router and tsc) that must be
 * regenerated before every consumer — the web script chain does that and
 * the file is gitignored, never committed.
 */

export const GENERATED_FILES = [
	{
		path: "apps/web/public/licenses.json",
		regenerate: "node scripts/generate-licenses.mjs",
	},
	{
		path: "apps/web/public/LICENSE",
		regenerate: "node scripts/generate-licenses.mjs",
	},
]

export const GENERATED_FILE_PATHS = GENERATED_FILES.map((file) => file.path)
