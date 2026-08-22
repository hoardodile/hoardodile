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
import { DomainError } from "../errors.ts"
import {
	createNextVersion,
	currentVersion,
	ensureBootstrapVersion,
	listVersions,
	readActiveVersion,
	writeActiveVersion,
} from "./version.ts"

describe("listVersions", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-list-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("empty directory returns empty array", () => {
		expect(listVersions(root)).toEqual([])
	})

	test("ignores non-numeric directory names", () => {
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		mkdirSync(join(root, "versions", "foo"), { recursive: true })
		mkdirSync(join(root, "versions", ".hidden"), { recursive: true })
		mkdirSync(join(root, "versions", "01"), { recursive: true })
		expect(listVersions(root)).toEqual([1])
	})

	test("returns sorted ascending", () => {
		for (const v of [3, 1, 10, 2]) {
			mkdirSync(join(root, "versions", String(v)), { recursive: true })
		}
		expect(listVersions(root)).toEqual([1, 2, 3, 10])
	})
})

describe("currentVersion", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-cur-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("returns 0 when no versions exist", () => {
		expect(currentVersion(root)).toBe(0)
	})

	test("returns max version number", () => {
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		mkdirSync(join(root, "versions", "5"), { recursive: true })
		expect(currentVersion(root)).toBe(5)
	})
})

describe("ensureBootstrapVersion", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-boot-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("creates versions/1 on empty storage", () => {
		const v = ensureBootstrapVersion(root)
		expect(v).toBe(1)
		expect(existsSync(join(root, "versions", "1"))).toBe(true)
	})

	test("is a no-op when any version already exists", () => {
		mkdirSync(join(root, "versions", "3"), { recursive: true })
		const v = ensureBootstrapVersion(root)
		expect(v).toBe(3)
		expect(existsSync(join(root, "versions", "1"))).toBe(false)
	})
})

describe("readActiveVersion", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-read-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("falls back to current when state file is missing", () => {
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		expect(readActiveVersion(root)).toBe(2)
	})

	test("returns persisted active when it exists", () => {
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(
			join(root, "local", "version-state.json"),
			JSON.stringify({ active: 1 }),
		)
		expect(readActiveVersion(root)).toBe(1)
	})

	test("falls back to current when state points at missing version", () => {
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(
			join(root, "local", "version-state.json"),
			JSON.stringify({ active: 99 }),
		)
		expect(readActiveVersion(root)).toBe(2)
	})

	test("falls back to current when state file is malformed", () => {
		mkdirSync(join(root, "versions", "3"), { recursive: true })
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(join(root, "local", "version-state.json"), "not json")
		expect(readActiveVersion(root)).toBe(3)
	})
})

describe("writeActiveVersion", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-write-"))
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		mkdirSync(join(root, "versions", "2"), { recursive: true })
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("persists valid active version", () => {
		writeActiveVersion(root, 1)
		const raw = readFileSync(join(root, "local", "version-state.json"), "utf8")
		expect(JSON.parse(raw)).toEqual({ active: 1 })
	})

	test("rejects unknown version", () => {
		try {
			writeActiveVersion(root, 99)
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("version.not_found")
		}
	})
})

describe("createNextVersion", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-next-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("throws when no version exists yet", () => {
		try {
			createNextVersion(root, () => {})
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("version.bootstrap_required")
		}
	})

	test("snapshots the live DB into versions/<prev>/app.sqlite", () => {
		// Bootstrap version 1, then have the injected vacuum write a marker
		// file — the primitive's job is the destination, not the sqlite
		// snapshot (the server's DbHandles.vacuumInto owns that).
		ensureBootstrapVersion(root)
		const result = createNextVersion(root, (dest) => {
			writeFileSync(dest, "snapshot")
		})

		expect(result.previous).toBe(1)
		expect(result.created).toBe(2)

		const snapshotPath = join(root, "versions", "1", "app.sqlite")
		expect(existsSync(snapshotPath)).toBe(true)
		expect(readFileSync(snapshotPath, "utf8")).toBe("snapshot")
	})

	test("throws when snapshot already exists", () => {
		ensureBootstrapVersion(root)

		// First call succeeds
		createNextVersion(root, (dest) => {
			writeFileSync(dest, "snapshot")
		})

		// After first publish, current version becomes 2; the next snapshot
		// target would be versions/2/app.sqlite. Pre-create it to trigger
		// the already_exists guard.
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		writeFileSync(join(root, "versions", "2", "app.sqlite"), "")

		try {
			createNextVersion(root, () => {
				expect.unreachable("vacuumInto should not be called")
			})
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("version.already_exists")
		}
		expect(existsSync(join(root, "versions", "3"))).toBe(false)
		expect(currentVersion(root)).toBe(2)
	})

	test("copies installed plugins into the next version", () => {
		ensureBootstrapVersion(root)
		const pluginId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
		const src = join(root, "versions", "1", "plugins", pluginId)
		mkdirSync(src, { recursive: true })
		writeFileSync(join(src, "manifest.json"), JSON.stringify({ id: pluginId }))
		writeFileSync(join(src, "main.js"), "export default {}\n")
		mkdirSync(join(root, "versions", "1", "plugins", ".staging-x"), {
			recursive: true,
		})
		mkdirSync(join(root, "versions", "1", "plugins", "not-a-plugin"), {
			recursive: true,
		})

		createNextVersion(root, (dest) => {
			writeFileSync(dest, "snapshot")
		})

		expect(
			existsSync(join(root, "versions", "2", "plugins", pluginId, "main.js")),
		).toBe(true)
		expect(
			existsSync(join(root, "versions", "1", "plugins", pluginId, "main.js")),
		).toBe(true)
		expect(
			existsSync(join(root, "versions", "2", "plugins", ".staging-x")),
		).toBe(false)
		expect(
			existsSync(join(root, "versions", "2", "plugins", "not-a-plugin")),
		).toBe(false)
	})

	test("removes the next version directory when vacuumInto throws", () => {
		ensureBootstrapVersion(root)
		try {
			createNextVersion(root, () => {
				throw new Error("vacuum failed")
			})
			expect.unreachable("should have thrown")
		} catch (err) {
			expect((err as Error).message).toBe("vacuum failed")
		}
		expect(existsSync(join(root, "versions", "2"))).toBe(false)
		expect(currentVersion(root)).toBe(1)
	})
})
