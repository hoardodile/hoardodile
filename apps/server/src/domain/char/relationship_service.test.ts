import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createRelationshipService } from "./relationship_service.ts"
import { createCharacterService } from "./service.ts"

let h: DbHandles
let tmpDir: string
let relationships: ReturnType<typeof createRelationshipService>
let alice: { id: string }
let bob: { id: string }
let counter = 0

function nextId() {
	return `id_${++counter}`
}

beforeEach(async () => {
	tmpDir = await mkdtemp(join(tmpdir(), "app-rel-test-"))
	h = openDb(":memory:")
	h.runMigrations()
	const paths = createStoragePaths({ root: tmpDir })
	const charService = createCharacterService({
		db: h.db,
		paths,
		newId: nextId,
		readOnly: { current: false },
	})
	relationships = createRelationshipService({ db: h.db, newId: nextId })
	alice = await charService.create({ name: "Alice" })
	bob = await charService.create({ name: "Bob" })
})

afterEach(async () => {
	h.close()
	await rm(tmpDir, { recursive: true, force: true })
})

describe("relationship types", () => {
	test("create and list a relationship type", async () => {
		const t = await relationships.createType({
			name: "Friend",
			selfLabel: "friend of",
			targetLabel: "friend of",
			intro: "close bond",
			color: "#abc",
			pinned: true,
		})
		expect(t.name).toBe("Friend")
		expect(t.selfLabel).toBe("friend of")
		expect(t.intro).toBe("close bond")
		expect(t.color).toBe("#abc")
		expect(t.pinned).toBe(true)
		expect(await relationships.listTypes()).toHaveLength(1)
	})

	test("listTypesWithCounts returns edge counts", async () => {
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const listed = await relationships.listTypesWithCounts()
		expect(listed).toHaveLength(1)
		expect(listed[0]?.edgeCount).toBe(1)
	})

	test("update a relationship type", async () => {
		const t = await relationships.createType({ name: "Friend" })
		const updated = await relationships.updateType({
			id: t.id,
			name: "Best Friend",
		})
		expect(updated.name).toBe("Best Friend")
		const listedType = (await relationships.listTypes())[0]
		expect(listedType?.name).toBe("Best Friend")
	})

	test("delete a relationship type removes it", async () => {
		const t = await relationships.createType({ name: "Rival" })
		await relationships.deleteType(t.id)
		expect(await relationships.listTypes()).toHaveLength(0)
	})

	test("delete non-existent type throws NOT_FOUND", async () => {
		await expect(relationships.deleteType("ghost")).rejects.toThrowError(
			/not found/i,
		)
	})

	test("reorder types updates list order", async () => {
		const first = await relationships.createType({ name: "Alpha" })
		const second = await relationships.createType({ name: "Beta" })
		const third = await relationships.createType({ name: "Gamma" })
		await relationships.reorderTypes([third.id, first.id, second.id])
		const listed = await relationships.listTypes()
		expect(listed.map((type) => type.id)).toEqual([
			third.id,
			first.id,
			second.id,
		])
		expect(listed.map((type) => type.position)).toEqual([0, 1, 2])
	})
})

describe("characterships", () => {
	test("create a charactership between two characters", async () => {
		const t = await relationships.createType({ name: "Friend" })
		const cs = await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		expect(cs.selfId).toBe(alice.id)
		expect(cs.targetId).toBe(bob.id)
		expect(cs.typeId).toBe(t.id)
	})

	test("list characterships for a character", async () => {
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const list = await relationships.listCharacterships(alice.id)
		expect(list).toHaveLength(1)
		expect(list[0]?.targetId).toBe(bob.id)
	})

	test("self-link is rejected", async () => {
		const t = await relationships.createType({ name: "Self" })
		await expect(
			relationships.createCharactership({
				typeId: t.id,
				selfId: alice.id,
				targetId: alice.id,
			}),
		).rejects.toThrowError(/itself/)
	})

	test("duplicate edges of the same type are rejected", async () => {
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await expect(
			relationships.createCharactership({
				typeId: t.id,
				selfId: alice.id,
				targetId: bob.id,
			}),
		).rejects.toThrowError(/already exists/i)
		const list = await relationships.listCharacterships(alice.id)
		expect(list).toHaveLength(1)
	})

	test("allows same pair with different relationship type", async () => {
		const friend = await relationships.createType({ name: "Friend" })
		const crush = await relationships.createType({ name: "Crush" })
		await relationships.createCharactership({
			typeId: friend.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const second = await relationships.createCharactership({
			typeId: crush.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		expect(second.typeId).toBe(crush.id)
		const list = await relationships.listCharacterships(alice.id)
		expect(list).toHaveLength(2)
	})

	test("update notes on a charactership", async () => {
		const t = await relationships.createType({ name: "Friend" })
		const cs = await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
			notes: "old note",
		})
		const updated = await relationships.updateCharactership({
			id: cs.id,
			notes: "new note",
		})
		expect(updated.notes).toBe("new note")
	})

	test("delete a charactership", async () => {
		const t = await relationships.createType({ name: "Friend" })
		const cs = await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await relationships.deleteCharactership(cs.id)
		expect(await relationships.listCharacterships(alice.id)).toHaveLength(0)
	})

	test("create charactership bumps self character updatedAt", async () => {
		const paths = createStoragePaths({ root: tmpDir })
		const charService = createCharacterService({
			db: h.db,
			paths,
			newId: nextId,
			readOnly: { current: false },
		})
		const before = (await charService.detail(alice.id)).updatedAt
		await new Promise((r) => setTimeout(r, 5))
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const after = (await charService.detail(alice.id)).updatedAt
		expect(after).toBeGreaterThan(before)
	})

	test("delete with dependencies throws CONFLICT", async () => {
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await expect(relationships.deleteType(t.id)).rejects.toThrowError(/in use/i)
	})

	test("forceDelete removes type and its characterships", async () => {
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await relationships.forceDeleteType(t.id, "Friend")
		expect(await relationships.listTypes()).toHaveLength(0)
		expect(await relationships.listCharacterships(alice.id)).toHaveLength(0)
	})

	test("stores symmetric endpoints in lexicographic order", async () => {
		const t = await relationships.createType({
			name: "Friend",
			kind: "symmetric",
			hierarchyFrom: null,
		})
		const cs = await relationships.createCharactership({
			typeId: t.id,
			selfId: bob.id,
			targetId: alice.id,
		})
		expect(cs.selfId).toBe(alice.id)
		expect(cs.targetId).toBe(bob.id)
	})

	test("rejects reverse duplicate on symmetric type", async () => {
		const t = await relationships.createType({
			name: "Friend",
			kind: "symmetric",
			hierarchyFrom: null,
		})
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await expect(
			relationships.createCharactership({
				typeId: t.id,
				selfId: bob.id,
				targetId: alice.id,
			}),
		).rejects.toThrowError(/already exists/i)
	})

	test("creates hierarchical type with hierarchyFrom target", async () => {
		const t = await relationships.createType({
			name: "Child",
			kind: "hierarchical",
			hierarchyFrom: "target",
		})
		expect(t.hierarchyFrom).toBe("target")
	})

	test("rejects edge that would create hierarchy cycle", async () => {
		const t = await relationships.createType({
			name: "Mentor",
			kind: "hierarchical",
			hierarchyFrom: "self",
		})
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		await expect(
			relationships.createCharactership({
				typeId: t.id,
				selfId: bob.id,
				targetId: alice.id,
			}),
		).rejects.toThrowError(/cycle/i)
	})

	test("allows reverse directed edges between same pair", async () => {
		const t = await relationships.createType({ name: "Crush" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const reverse = await relationships.createCharactership({
			typeId: t.id,
			selfId: bob.id,
			targetId: alice.id,
		})
		expect(reverse.selfId).toBe(bob.id)
		expect(reverse.targetId).toBe(alice.id)
	})

	test("listCharacterships returns edge when character is targetId", async () => {
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const list = await relationships.listCharacterships(bob.id)
		expect(list).toHaveLength(1)
		expect(list[0]?.selfId).toBe(alice.id)
	})

	test("creates and lists external charactership", async () => {
		const t = await relationships.createType({ name: "Crush" })
		const cs = await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			externalName: "Tokyo",
		})
		expect(cs.externalName).toBe("Tokyo")
		expect(cs.targetId).toBeNull()
		const list = await relationships.listCharacterships(alice.id)
		expect(list).toHaveLength(1)
		expect(list[0]?.externalName).toBe("Tokyo")
	})

	test("creates and lists external charactership with real character on target side", async () => {
		const t = await relationships.createType({ name: "Crush" })
		const cs = await relationships.createCharactership({
			typeId: t.id,
			targetId: alice.id,
			externalName: "Tokyo",
		})
		expect(cs.externalName).toBe("Tokyo")
		expect(cs.selfId).toBeNull()
		const list = await relationships.listCharacterships(alice.id)
		expect(list).toHaveLength(1)
		expect(list[0]?.externalName).toBe("Tokyo")
	})

	test("rejects duplicate external charactership", async () => {
		const t = await relationships.createType({ name: "Crush" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			externalName: "Tokyo",
		})
		await expect(
			relationships.createCharactership({
				typeId: t.id,
				selfId: alice.id,
				externalName: "Tokyo",
			}),
		).rejects.toThrowError(/already exists/i)
		const list = await relationships.listCharacterships(alice.id)
		expect(list).toHaveLength(1)
	})

	test("listCharactershipsForCharacters returns empty for empty input", async () => {
		expect(await relationships.listCharactershipsForCharacters([])).toEqual([])
	})

	test("listCharactershipsForCharacters batch-fetches edges touching any id", async () => {
		const paths = createStoragePaths({ root: tmpDir })
		const charService = createCharacterService({
			db: h.db,
			paths,
			newId: nextId,
			readOnly: { current: false },
		})
		const carol = await charService.create({ name: "Carol" })
		const friend = await relationships.createType({ name: "Friend" })
		const edgeAliceBob = await relationships.createCharactership({
			typeId: friend.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const edgeBobCarol = await relationships.createCharactership({
			typeId: friend.id,
			selfId: bob.id,
			targetId: carol.id,
		})
		const batch = await relationships.listCharactershipsForCharacters([
			alice.id,
			carol.id,
		])
		expect(batch).toHaveLength(2)
		expect(batch.map((edge) => edge.id).sort()).toEqual(
			[edgeAliceBob.id, edgeBobCarol.id].sort(),
		)
	})

	test("updates charactership metadata", async () => {
		const t = await relationships.createType({ name: "Friend" })
		const cs = await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const updated = await relationships.updateCharactership({
			id: cs.id,
			metadata: { order: 1, note: "close" },
		})
		expect(updated.metadata).toEqual({ order: 1, note: "close" })
	})

	test("create charactership bumps target character updatedAt", async () => {
		const paths = createStoragePaths({ root: tmpDir })
		const charService = createCharacterService({
			db: h.db,
			paths,
			newId: nextId,
			readOnly: { current: false },
		})
		const before = (await charService.detail(bob.id)).updatedAt
		await new Promise((r) => setTimeout(r, 5))
		const t = await relationships.createType({ name: "Friend" })
		await relationships.createCharactership({
			typeId: t.id,
			selfId: alice.id,
			targetId: bob.id,
		})
		const after = (await charService.detail(bob.id)).updatedAt
		expect(after).toBeGreaterThan(before)
	})
})
