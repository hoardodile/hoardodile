#!/usr/bin/env node
/**
 * Guard against accidental bumps of dependencies whose fixed versions are
 * load-bearing for the document diff feature.
 *
 * Why these versions are pinned:
 *
 * - The diff view (`apps/web/src/features/doc/diffCompute.ts`) is built on
 *   BlockNote internals: `blockToNode` and `editor._tiptapEditor` from
 *   `@blocknote/*`, plus the `insertion`/`deletion` suggestion marks that
 *   BlockNote's default schema registers. Bumping `@blocknote/*` past
 *   0.51.x breaks it: 0.52.0 removed those marks from core's default
 *   extension set (verified by inspecting the 0.52.0/0.53.0/0.54.0
 *   tarballs — the marks now only exist when the Yjs/AI extension that
 *   provides them is loaded, with different attrs/DOM), so the diff
 *   transaction marks no longer match the schema.
 * - `@handlewithcare/prosemirror-suggest-changes` is the transform that
 *   turns the computed changes into those marks; it must stay compatible
 *   with the schema above.
 * - The 10 tsup-built packages pin `typescript: 5.9.3` on purpose
 *   (see AGENTS.md); the catalog pin is 7.0.2. Both are legitimate.
 * - `@videojs/react` is an exact-pinned prerelease (10.0.0-beta.25): the
 *   gallery player composition API (`Provider`/`Container` on the
 *   createPlayer result) churns between betas, and `pnpm up -L` ignores
 *   exact pins — the last bump to 10.0.0-beta.31 broke the typecheck.
 *
 * This guard reads pnpm-lock.yaml, so every bump path (pnpm up -L, a manual
 * version edit, a dependency PR) is caught at pre-commit and CI time. To
 * upgrade a protected package deliberately, follow the checklist in
 * `apps/web/src/features/doc/README.md`, adapt the code to the new API,
 * then update PINNED and the exact pins in the declaring `package.json`
 * in the same change.
 *
 * Usage:
 *   node scripts/guard-protected-deps.mjs             # check ./pnpm-lock.yaml
 *   node scripts/guard-protected-deps.mjs <lockfile>  # check a copy (testing)
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/** Single source of truth for protected direct dependencies (exact pins). */
export const PINNED = {
	"@blocknote/core": "0.51.4",
	"@blocknote/react": "0.51.4",
	"@blocknote/mantine": "0.51.4",
	"@blocknote/shadcn": "0.51.4",
	"@handlewithcare/prosemirror-suggest-changes": "0.1.8",
	"@videojs/react": "10.0.0-beta.25",
}

export const PROTECTED_PACKAGE_NAMES = new Set([
	...Object.keys(PINNED),
	// Tiptap-built packages pin 5.9.3; the rest of the workspace uses the
	// catalog 7.0.2. Both are allowed; anything else is a drift.
	"typescript",
])

const TYPESCRIPT_ALLOWED_SPECIFIERS = new Set(["5.9.3", "catalog:"])
const TYPESCRIPT_ALLOWED_VERSIONS = new Set(["5.9.3", "7.0.2"])

/** Load importers from a pnpm lockfile: `{ name, specifier, version }[]`. */
function readLockfileEntries(path) {
	const lines = readFileSync(path, "utf8").split(/\r?\n/)
	const entries = []
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i]?.match(/^ {6}(.*?):\s*$/)
		if (!match) continue
		const name = match[1].trim().replace(/^'|'$/g, "")
		if (name === "" || (!name.includes("/") && !/^[a-z0-9-]+$/i.test(name))) {
			// Only plausible package names; every other 6-space indent is not
			// an importer entry (snapshots use `name: version` on one line).
			continue
		}
		const specifier = lines[i + 1]?.match(/^ {8}specifier:\s*(.*)$/)?.[1]
		const version = lines[i + 2]?.match(/^ {8}version:\s*(.*)$/)?.[1]
		if (specifier === undefined || version === undefined) continue
		entries.push({
			name,
			specifier: specifier.trim().replace(/^'|'$/g, ""),
			version: version.trim(),
		})
	}
	return entries
}

/** Strip the peer-dependency suffix pnpm appends: `0.51.4(@types/hast@…)`. */
function normalizeVersion(version) {
	return version.split("(")[0].trim()
}

function findViolations(entries) {
	const findings = []
	const blocknoteVersions = new Set()

	for (const entry of entries) {
		const pinned = PINNED[entry.name]
		const resolved = normalizeVersion(entry.version)
		if (pinned !== undefined) {
			if (entry.name.startsWith("@blocknote/")) {
				blocknoteVersions.add(resolved)
			}
			if (entry.specifier !== pinned) {
				findings.push(
					`${entry.name}: expected exact specifier \`${pinned}\`, got \`${entry.specifier}\``,
				)
			}
			if (resolved !== pinned) {
				findings.push(
					`${entry.name}: expected resolved version ${pinned}, got ${resolved}`,
				)
			}
		}
		if (entry.name === "typescript") {
			if (!TYPESCRIPT_ALLOWED_SPECIFIERS.has(entry.specifier)) {
				findings.push(
					`typescript: unexpected specifier \`${entry.specifier}\` (allowed: 5.9.3 or catalog:)`,
				)
			}
			if (!TYPESCRIPT_ALLOWED_VERSIONS.has(resolved)) {
				findings.push(
					`typescript: unexpected version ${resolved} (allowed: 5.9.3 or 7.0.2)`,
				)
			}
		}
	}

	// The four BlockNote packages must move as one unit.
	const blocknotePackages = Object.keys(PINNED).filter((name) =>
		name.startsWith("@blocknote/"),
	)
	const presentBlocknote = blocknotePackages.filter((name) =>
		entries.some((entry) => entry.name === name),
	)
	if (presentBlocknote.length > 1 && blocknoteVersions.size > 1) {
		findings.push(
			`@blocknote/* resolved to mixed versions (${[...blocknoteVersions].join(
				", ",
			)}) — the four packages must be upgraded together`,
		)
	}

	return findings
}

function main() {
	const lockfile = process.argv[2] || "pnpm-lock.yaml"
	if (!existsSync(lockfile)) {
		console.error(`guard-protected-deps: lockfile not found: ${lockfile}`)
		process.exit(1)
	}

	const entries = readLockfileEntries(lockfile)
	const findings = findViolations(entries)

	if (findings.length > 0) {
		console.error(
			`\nProtected-dependency guard failed (lockfile: ${lockfile}):`,
		)
		for (const finding of findings) {
			console.error(`  - ${finding}`)
		}
		console.error(
			`\nThese versions are load-bearing for the document diff feature and
must not be bumped on a whim:
  - @blocknote/* stays at 0.51.4 — 0.52.0+ removed the insertion/deletion
    suggestion marks from the default schema, breaking the diff view
    (apps/web/src/features/doc/diffCompute.ts uses blockToNode,
    editor._tiptapEditor and those marks).
  - @handlewithcare/prosemirror-suggest-changes stays at 0.1.8 — it is the
    transform that emits those marks.
  - typescript stays at 5.9.3 (tsup packages) / 7.0.2 (catalog).

To upgrade deliberately, follow the checklist in
apps/web/src/features/doc/README.md, adapt the diff machinery, and update
the exact pins plus the PINNED table in scripts/guard-protected-deps.mjs
in the same change.`,
		)
		process.exit(1)
	}

	console.log("Protected-dependency guard passed.")
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main()
}
