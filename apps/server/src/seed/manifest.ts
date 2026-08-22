/**
 * On-disk demo-seed sentinel. Lives only in this folder — not a shared
 * schema — so a random JSON file cannot mark a real library as seedable.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const DEMO_SEED_KIND = "hoardodile-demo-seed"

export type NamedId = {
	readonly id: string
	readonly name: string
}

export type SeedManifest = {
	readonly kind: typeof DEMO_SEED_KIND
	status: "in-progress" | "complete"
	cats: NamedId[]
	tags: NamedId[]
	traits: NamedId[]
	chars: NamedId[]
	relationshipTypes: NamedId[]
	relationshipEdges: string[]
	resources: NamedId[]
	collections: NamedId[]
	docs: NamedId[]
	comments: string[]
	danmaku: string[]
	syncDevices: string[]
}

export function seedManifestPath(root: string): string {
	return join(root, "local", "demo-seed.json")
}

export function emptySeedManifest(): SeedManifest {
	return {
		kind: DEMO_SEED_KIND,
		status: "in-progress",
		cats: [],
		tags: [],
		traits: [],
		chars: [],
		relationshipTypes: [],
		relationshipEdges: [],
		resources: [],
		collections: [],
		docs: [],
		comments: [],
		danmaku: [],
		syncDevices: [],
	}
}

function isNamedId(value: unknown): value is NamedId {
	if (typeof value !== "object" || value === null) return false
	if (!("id" in value) || !("name" in value)) return false
	return typeof value.id === "string" && typeof value.name === "string"
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isNamedIdArray(value: unknown): value is NamedId[] {
	return Array.isArray(value) && value.every(isNamedId)
}

/** True when `value` is a sentinel this CLI wrote. */
export function isSeedManifest(value: unknown): value is SeedManifest {
	if (typeof value !== "object" || value === null) return false
	if (!("kind" in value) || value.kind !== DEMO_SEED_KIND) return false
	if (!("status" in value)) return false
	if (value.status !== "in-progress" && value.status !== "complete") {
		return false
	}
	const row = value
	return (
		"cats" in row &&
		isNamedIdArray(row.cats) &&
		"tags" in row &&
		isNamedIdArray(row.tags) &&
		"traits" in row &&
		isNamedIdArray(row.traits) &&
		"chars" in row &&
		isNamedIdArray(row.chars) &&
		"relationshipTypes" in row &&
		isNamedIdArray(row.relationshipTypes) &&
		"relationshipEdges" in row &&
		isStringArray(row.relationshipEdges) &&
		"resources" in row &&
		isNamedIdArray(row.resources) &&
		"collections" in row &&
		isNamedIdArray(row.collections) &&
		"docs" in row &&
		isNamedIdArray(row.docs) &&
		"comments" in row &&
		isStringArray(row.comments) &&
		"danmaku" in row &&
		isStringArray(row.danmaku) &&
		"syncDevices" in row &&
		isStringArray(row.syncDevices)
	)
}

export function parseSeedManifest(raw: unknown): SeedManifest | undefined {
	return isSeedManifest(raw) ? raw : undefined
}

export function readSeedManifestFromRoot(
	root: string,
): SeedManifest | undefined {
	try {
		const raw: unknown = JSON.parse(
			readFileSync(seedManifestPath(root), "utf8"),
		)
		return parseSeedManifest(raw)
	} catch {
		return undefined
	}
}

export function writeSeedManifestToRoot(
	root: string,
	manifest: SeedManifest,
): void {
	mkdirSync(join(root, "local"), { recursive: true })
	writeFileSync(
		seedManifestPath(root),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	)
}
