import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createSeedRemovalsStore } from "./seed-removals.ts"

describe("createSeedRemovalsStore", () => {
	let root: string
	let file: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "seed-removals-"))
		file = join(root, "local", "seed-removals.json")
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("starts empty when the marker file is missing", () => {
		const store = createSeedRemovalsStore(file)
		expect(store.read().size).toBe(0)
	})

	test("add persists and survives a fresh store (restart)", () => {
		const first = createSeedRemovalsStore(file)
		first.add("11111111-1111-4111-8111-111111111111")

		const second = createSeedRemovalsStore(file)
		expect(second.read()).toEqual(
			new Set(["11111111-1111-4111-8111-111111111111"]),
		)
	})

	test("remove persists and survives a fresh store", () => {
		const first = createSeedRemovalsStore(file)
		first.add("11111111-1111-4111-8111-111111111111")
		first.add("22222222-2222-4222-8222-222222222222")
		first.remove("11111111-1111-4111-8111-111111111111")

		const second = createSeedRemovalsStore(file)
		expect(second.read()).toEqual(
			new Set(["22222222-2222-4222-8222-222222222222"]),
		)
	})

	test("a corrupt marker file reads as empty", () => {
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(file, "{ not json")
		const store = createSeedRemovalsStore(file)
		expect(store.read().size).toBe(0)
	})

	test("non-string and empty entries are skipped", () => {
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(
			file,
			JSON.stringify({
				version: 1,
				removed: ["11111111-1111-4111-8111-111111111111", 42, "", null],
			}),
		)
		const store = createSeedRemovalsStore(file)
		expect(store.read()).toEqual(
			new Set(["11111111-1111-4111-8111-111111111111"]),
		)
	})

	test("add writes the marker file on disk", () => {
		const store = createSeedRemovalsStore(file)
		store.add("11111111-1111-4111-8111-111111111111")
		expect(existsSync(file)).toBe(true)
		const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
			readonly removed: readonly string[]
		}
		expect(parsed.removed).toEqual(["11111111-1111-4111-8111-111111111111"])
	})
})
