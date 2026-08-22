import { asc, count, eq, sql } from "drizzle-orm"
import { characters } from "src/domain/char/schema.ts"
import {
	buildFindById,
	buildInsert,
	buildListAll,
	buildPatch,
	buildRemove,
} from "src/infra/db/builders.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import { traitDefs } from "./schema.ts"

export type TraitDefRow = typeof traitDefs.$inferSelect

export type TraitDefDbValues = {
	readonly name: string
	readonly kind: "text" | "multitext" | "number" | "height" | "weight" | "date"
	readonly position: number
	readonly pinned: boolean
	readonly color: string
	readonly intro: string
}

export type TraitDefDbPatch = Partial<
	Pick<
		typeof traitDefs.$inferInsert,
		"name" | "position" | "pinned" | "color" | "intro" | "updatedAt"
	>
>

/**
 * Pure Drizzle query layer for the trait module. No business rules; the
 * service layer enforces uniqueness constraints and deletion guards.
 */
export type TraitRepository = {
	/** @throws {DomainError} NOT_FOUND when the row is missing. */
	findById(id: string): TraitDefRow
	findByName(name: string): TraitDefRow | undefined
	listAll(): readonly TraitDefRow[]
	insert(id: string, values: TraitDefDbValues, ts: number): void
	patch(id: string, fields: TraitDefDbPatch): void
	remove(id: string): void
	/** Count characters whose JSON `trait_values` map contains a non-null value at the given trait key. */
	countCharacterUsages(traitId: string): number
}

export function buildTraitRepository(client: DbClient): TraitRepository {
	const findById = buildFindById<TraitDefRow>(client, traitDefs, "trait")
	const listAll = buildListAll<TraitDefRow>(client, traitDefs, [
		asc(traitDefs.position),
		asc(traitDefs.name),
	])
	const insert = buildInsert<TraitDefDbValues>(client, traitDefs)
	const patch = buildPatch<TraitDefDbPatch>(client, traitDefs)
	const remove = buildRemove(client, traitDefs)

	function findByName(name: string): TraitDefRow | undefined {
		return client.select().from(traitDefs).where(eq(traitDefs.name, name)).get()
	}

	function countCharacterUsages(traitId: string): number {
		// JSON path uses double-quoted key to support arbitrary identifiers safely.
		const path = `$."${traitId}"`
		const row = client
			.select({ value: count() })
			.from(characters)
			.where(sql`json_extract(${characters.traitValues}, ${path}) IS NOT NULL`)
			.get()
		return row?.value ?? 0
	}

	return {
		findById,
		findByName,
		listAll,
		insert,
		patch,
		remove,
		countCharacterUsages,
	}
}
