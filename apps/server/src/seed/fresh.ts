/**
 * Path-level gate: seed only an empty directory or a tree this CLI already
 * marked. Does not open SQLite. Never writes a sentinel onto a non-empty
 * root — that would launder a real library into a "demo" tree.
 */

import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import {
	emptySeedManifest,
	readSeedManifestFromRoot,
	type SeedManifest,
	writeSeedManifestToRoot,
} from "./manifest.ts"

export type SeedRootState =
	| { readonly kind: "empty"; readonly root: string }
	| {
			readonly kind: "demo"
			readonly root: string
			readonly manifest: SeedManifest
	  }

function refuseOldLibrary(root: string): never {
	throw new Error(
		`seed: STORAGE_ROOT is not an empty official demo library (${root}). This command only fills a new empty directory (site demo, QA, or a self-hosted preview). Use --storage ./tmp/demo-storage or point STORAGE_ROOT at an empty folder.`,
	)
}

/**
 * Desktop installs carry the user's real library. This CLI is source-only.
 */
export function assertNotPackaged(env: NodeJS.ProcessEnv = process.env): void {
	if (env.HOARDODILE_PACKAGED === "1") {
		throw new Error(
			"seed: refusing packaged runtime; this CLI is not for desktop installs",
		)
	}
}

function listTopLevel(root: string): readonly string[] {
	if (!existsSync(root)) return []
	return readdirSync(root)
}

/** Resolve junctions/symlinks when the path already exists. */
export function resolveSeedRoot(root: string): string {
	const absolute = resolve(root)
	if (!existsSync(absolute)) return absolute
	return realpathSync(absolute)
}

/**
 * Classify `root` without creating files. Throws when the directory looks
 * like an existing library (including a fake demo-seed.json without `kind`).
 */
export function inspectSeedRoot(root: string): SeedRootState {
	const resolved = resolveSeedRoot(root)
	const entries = listTopLevel(resolved)
	const manifest = existsSync(resolved)
		? readSeedManifestFromRoot(resolved)
		: undefined
	if (manifest !== undefined) {
		return { kind: "demo", root: resolved, manifest }
	}
	if (entries.length === 0) {
		return { kind: "empty", root: resolved }
	}
	refuseOldLibrary(resolved)
}

/**
 * Empty roots get an in-progress sentinel *before* version bootstrap so a
 * crash cannot be mistaken for an old library. Existing demo trees are
 * left untouched. Dry-run never writes.
 */
export function prepareSeedRoot(
	root: string,
	opts: { readonly dryRun: boolean },
): SeedRootState {
	const first = inspectSeedRoot(root)
	if (first.kind === "demo") return first
	if (opts.dryRun) return first
	mkdirSync(first.root, { recursive: true })
	const resolved = resolveSeedRoot(first.root)
	if (listTopLevel(resolved).length > 0) {
		refuseOldLibrary(resolved)
	}
	const manifest = emptySeedManifest()
	writeSeedManifestToRoot(resolved, manifest)
	return { kind: "demo", root: resolved, manifest }
}
