/**
 * @vitest-environment node
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	SWAP_ENTRIES,
	swapBackupRoot,
	swapMarkerPath,
	swapStagingRoot,
} from "./resource-support.ts"
import {
	assertSwapSpace,
	beginSwap,
	commitSwap,
	deleteBackup,
	recoverAtBoot,
	rollbackSwap,
} from "./resources-swap.ts"

const scratch: string[] = []

afterEach(() => {
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

/**
 * Build a fake resources/ tree: dirs node/ server/ plugins/ + marker.
 */
function makeTree(root: string, version: string): void {
	for (const entry of SWAP_ENTRIES) {
		const target = entry === "resources-version.json" ? root : join(root, entry)
		mkdirSync(target, { recursive: true })
		if (entry === "resources-version.json") {
			writeFileSync(
				join(root, entry),
				JSON.stringify({ schema: 1, version, nodeVersion: "24.0.0" }),
			)
		} else if (entry === "plugins") {
			writeFileSync(join(target, "gallery-manifest.json"), version)
		} else {
			writeFileSync(join(target, "main.js"), version)
		}
	}
}

function setTreeEntries(root: string, version: string): void {
	for (const entry of SWAP_ENTRIES) {
		const target = entry === "resources-version.json" ? root : join(root, entry)
		writeFileSync(
			entry === "resources-version.json"
				? join(root, entry)
				: join(target, "main.js"),
			version,
		)
	}
}

function readVersion(resourcesRoot: string, entry: string): string | undefined {
	const target =
		entry === "resources-version.json"
			? join(resourcesRoot, entry)
			: join(resourcesRoot, entry, "main.js")
	return existsSync(target) ? readFileSync(target, "utf8") : undefined
}

function renameDir(src: string, dest: string): void {
	rmSync(dest, { recursive: true, force: true })
	mkdirSync(dest, { recursive: true })
	rmSync(dest, { recursive: true, force: true })
	renameSync(src, dest)
}

function newLayout(): { resourcesRoot: string; stagingRoot: string } {
	const resourcesRoot = mkdtempSync(join(tmpdir(), "hd-swap-"))
	scratch.push(resourcesRoot)
	const stagingRoot = join(resourcesRoot, `.staging-1.2.0`)
	makeTree(resourcesRoot, "1.0.0")
	setTreeEntries(resourcesRoot, "1.0.0")
	makeTree(stagingRoot, "1.2.0")
	setTreeEntries(stagingRoot, "1.2.0")
	return { resourcesRoot, stagingRoot }
}

describe("beginSwap/commitSwap", () => {
	it("replaces the tree and keeps the backup until time-out", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" })

		expect(readVersion(resourcesRoot, "server")).toBe("1.2.0")
		expect(readVersion(resourcesRoot, "resources-version.json")).toBe("1.2.0")
		expect(existsSync(swapMarkerPath(resourcesRoot))).toBe(true)
		expect(
			readVersion(swapBackupRoot(resourcesRoot), ".olds-marker-file"),
		).toBe(undefined)
		expect(
			readFileSync(
				join(swapBackupRoot(resourcesRoot), "server", "main.js"),
				"utf8",
			),
		).toBe("1.0.0")
		expect(readdirSync(stagingRoot).length).toBe(0) // entries moved out

		commitSwap({ resourcesRoot })
		expect(existsSync(swapMarkerPath(resourcesRoot))).toBe(false)
		expect(existsSync(swapBackupRoot(resourcesRoot))).toBe(true) // soak holds it
		expect(existsSync(stagingRoot)).toBe(false)

		deleteBackup({ resourcesRoot })
		expect(existsSync(swapBackupRoot(resourcesRoot))).toBe(false)
	})

	it("throws when the staging tree is incomplete", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		rmSync(join(stagingRoot, "server"), { recursive: true, force: true })
		expect(() =>
			beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" }),
		).toThrow(/incomplete/)
	})
})

describe("rollbackSwap", () => {
	it("restores the previous tree", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" })
		rollbackSwap({ resourcesRoot })

		expect(readVersion(resourcesRoot, "server")).toBe("1.0.0")
		expect(readVersion(resourcesRoot, "plugins")).toBe("1.0.0")
		expect(existsSync(swapMarkerPath(resourcesRoot))).toBe(false)
		expect(existsSync(swapBackupRoot(resourcesRoot))).toBe(false)
		expect(existsSync(swapStagingRoot(resourcesRoot, "1.2.0"))).toBe(false)
	})

	it("restores a partial mid-swap state without touching unmoved entries", () => {
		const { resourcesRoot } = newLayout()
		// Crash right after the FIRST backup rename: node moved to the
		// backup, server/plugins/marker still in place, nothing staged in.
		writeFileSync(
			swapMarkerPath(resourcesRoot),
			'{"schema":1,"version":"1.2.0"}',
		)
		mkdirSync(swapBackupRoot(resourcesRoot), { recursive: true })
		renameDir(
			join(resourcesRoot, "node"),
			join(swapBackupRoot(resourcesRoot), "node"),
		)
		rollbackSwap({ resourcesRoot })

		expect(readVersion(resourcesRoot, "node")).toBe("1.0.0")
		expect(readVersion(resourcesRoot, "server")).toBe("1.0.0")
		expect(readVersion(resourcesRoot, "plugins")).toBe("1.0.0")
		expect(existsSync(swapMarkerPath(resourcesRoot))).toBe(false)
	})
})

describe("recoverAtBoot", () => {
	it("rolls back a crash mid-swap (marker + backup)", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" })
		// Simulate a crash right here: the caller never ran commitSwap.
		expect(recoverAtBoot(resourcesRoot)).toBe("rolled-back")
		expect(readVersion(resourcesRoot, "server")).toBe("1.0.0")
		expect(existsSync(swapMarkerPath(resourcesRoot))).toBe(false)
	})

	it("finishes the commit when the crash came after the swap completed", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" })
		deleteBackup({ resourcesRoot }) // crash removed the backup before commit
		expect(recoverAtBoot(resourcesRoot)).toBe("committed")
		expect(readVersion(resourcesRoot, "server")).toBe("1.2.0")
		expect(existsSync(swapMarkerPath(resourcesRoot))).toBe(false)
	})

	it("cleans up a leftover backup without a marker", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" })
		commitSwap({ resourcesRoot })
		expect(recoverAtBoot(resourcesRoot)).toBe("committed")
		expect(existsSync(swapBackupRoot(resourcesRoot))).toBe(false)
	})

	it("is a no-op on a clean tree", () => {
		const { resourcesRoot } = newLayout()
		expect(recoverAtBoot(resourcesRoot)).toBe("none")
		expect(readdirSync(resourcesRoot).sort()).toEqual([...SWAP_ENTRIES].sort())
	})

	it("cleans stale staging dirs without a marker", () => {
		const { resourcesRoot } = newLayout()
		mkdirSync(join(resourcesRoot, ".staging-9.9.9"), { recursive: true })
		mkdirSync(join(resourcesRoot, ".staging-old"), { recursive: true })
		expect(recoverAtBoot(resourcesRoot)).toBe("none")
		expect(
			readdirSync(resourcesRoot).some((name) => name.startsWith(".staging-")),
		).toBe(false)
	})
})

describe("space precheck and staging hygiene", () => {
	it("passes on a small temp tree", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		expect(() => assertSwapSpace({ resourcesRoot, stagingRoot })).not.toThrow()
	})

	it("begins with every entry in the backup and staging emptied", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" })
		for (const entry of SWAP_ENTRIES) {
			expect(existsSync(join(swapBackupRoot(resourcesRoot), entry))).toBe(true)
		}
		expect(readdirSync(stagingRoot).length).toBe(0)
	})

	it("commitSwap drops stale staging dirs", () => {
		const { resourcesRoot, stagingRoot } = newLayout()
		beginSwap({ resourcesRoot, stagingRoot, version: "1.2.0" })
		mkdirSync(join(resourcesRoot, ".staging-9.9.9"), { recursive: true })
		commitSwap({ resourcesRoot })
		expect(
			readdirSync(resourcesRoot).some((name) => name.startsWith(".staging-")),
		).toBe(false)
	})
})
