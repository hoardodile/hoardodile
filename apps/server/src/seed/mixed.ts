/**
 * After the DB is open: refuse libraries that contain anything this seed
 * did not record. Cleanup must not run when this fails — foreign rows
 * would be left in place while seed ids were deleted.
 */

import { listVersions } from "@hoardodile/host/hoard"
import { count } from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import {
	characters,
	characterships,
	relationshipTypes,
} from "src/domain/char/schema.ts"
import { resCollections } from "src/domain/col/schema.ts"
import { comments } from "src/domain/comment/schema.ts"
import { danmakus } from "src/domain/danmaku/schema.ts"
import { documents } from "src/domain/doc/schema.ts"
import { resources } from "src/domain/res/schema.ts"
import { syncDevices } from "src/domain/sync/schema.ts"
import { tags } from "src/domain/tag/schema.ts"
import { userActions } from "src/domain/trace/schema.ts"
import { traitDefs } from "src/domain/trait/schema.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import type { SeedManifest } from "./manifest.ts"

export type MixedSnapshot = {
	readonly versions: readonly number[]
	readonly userActionCount: number
	readonly resourceIds: readonly string[]
	readonly characterIds: readonly string[]
	readonly documentIds: readonly string[]
	readonly tagIds: readonly string[]
	readonly categoryIds: readonly string[]
	readonly traitIds: readonly string[]
	readonly collectionIds: readonly string[]
	readonly commentIds: readonly string[]
	readonly danmakuIds: readonly string[]
	readonly syncDeviceIds: readonly string[]
	readonly relationshipTypeIds: readonly string[]
	readonly relationshipEdgeIds: readonly string[]
}

function idsOf(rows: readonly { readonly id: string }[]): string[] {
	return rows.map((row) => row.id)
}

function namedIds(
	rows: readonly { readonly id: string }[],
): ReadonlySet<string> {
	return new Set(rows.map((row) => row.id))
}

function extras(
	label: string,
	found: readonly string[],
	allowed: ReadonlySet<string>,
): string | undefined {
	for (const id of found) {
		if (!allowed.has(id)) return `${label} ${id}`
	}
	return undefined
}

/** Pure check used by tests; no I/O. */
export function mixedReasons(
	snapshot: MixedSnapshot,
	manifest: SeedManifest,
): readonly string[] {
	const reasons: string[] = []
	if (snapshot.versions.length > 1) {
		reasons.push(`versions ${snapshot.versions.join(",")}`)
	}
	if (snapshot.userActionCount > 0) reasons.push("user_actions")
	const hits = [
		extras("resource", snapshot.resourceIds, namedIds(manifest.resources)),
		extras("character", snapshot.characterIds, namedIds(manifest.chars)),
		extras("document", snapshot.documentIds, namedIds(manifest.docs)),
		extras("tag", snapshot.tagIds, namedIds(manifest.tags)),
		extras("category", snapshot.categoryIds, namedIds(manifest.cats)),
		extras("trait", snapshot.traitIds, namedIds(manifest.traits)),
		extras(
			"collection",
			snapshot.collectionIds,
			namedIds(manifest.collections),
		),
		extras("comment", snapshot.commentIds, new Set(manifest.comments)),
		extras("danmaku", snapshot.danmakuIds, new Set(manifest.danmaku)),
		extras(
			"sync device",
			snapshot.syncDeviceIds,
			new Set(manifest.syncDevices),
		),
		extras(
			"relationship type",
			snapshot.relationshipTypeIds,
			namedIds(manifest.relationshipTypes),
		),
		extras(
			"relationship edge",
			snapshot.relationshipEdgeIds,
			new Set(manifest.relationshipEdges),
		),
	]
	for (const hit of hits) {
		if (hit !== undefined) reasons.push(hit)
	}
	return reasons
}

export function readMixedSnapshot(
	db: SqliteDb,
	hostDb: SqliteDb,
	storageRoot: string,
): MixedSnapshot {
	const actionCount = db.select({ n: count() }).from(userActions).get()
	return {
		versions: listVersions(storageRoot),
		userActionCount: actionCount?.n ?? 0,
		resourceIds: idsOf(db.select({ id: resources.id }).from(resources).all()),
		characterIds: idsOf(
			db.select({ id: characters.id }).from(characters).all(),
		),
		documentIds: idsOf(db.select({ id: documents.id }).from(documents).all()),
		tagIds: idsOf(db.select({ id: tags.id }).from(tags).all()),
		categoryIds: idsOf(db.select({ id: categories.id }).from(categories).all()),
		traitIds: idsOf(db.select({ id: traitDefs.id }).from(traitDefs).all()),
		collectionIds: idsOf(
			db.select({ id: resCollections.id }).from(resCollections).all(),
		),
		commentIds: idsOf(db.select({ id: comments.id }).from(comments).all()),
		danmakuIds: idsOf(db.select({ id: danmakus.id }).from(danmakus).all()),
		syncDeviceIds: idsOf(
			hostDb.select({ id: syncDevices.id }).from(syncDevices).all(),
		),
		relationshipTypeIds: idsOf(
			db.select({ id: relationshipTypes.id }).from(relationshipTypes).all(),
		),
		relationshipEdgeIds: idsOf(
			db.select({ id: characterships.id }).from(characterships).all(),
		),
	}
}

export function assertUnmixedLibrary(
	snapshot: MixedSnapshot,
	manifest: SeedManifest,
): void {
	const reasons = mixedReasons(snapshot, manifest)
	if (reasons.length === 0) return
	throw new Error(
		`seed: library contains data that is not from this demo seed (${reasons.join("; ")}). Refusing to write or delete.`,
	)
}
