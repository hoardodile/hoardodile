/**
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { assertNotPackaged, inspectSeedRoot, prepareSeedRoot } from "./fresh.ts"
import { emptySeedManifest, writeSeedManifestToRoot } from "./manifest.ts"
import { type MixedSnapshot, mixedReasons } from "./mixed.ts"

const temps: string[] = []

function tempRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), "hoardodile-seed-"))
	temps.push(dir)
	return dir
}

afterEach(() => {
	while (temps.length > 0) {
		const dir = temps.pop()
		if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
	}
})

function emptySnapshot(): MixedSnapshot {
	return {
		versions: [1],
		userActionCount: 0,
		resourceIds: [],
		characterIds: [],
		documentIds: [],
		tagIds: [],
		categoryIds: [],
		traitIds: [],
		collectionIds: [],
		commentIds: [],
		danmakuIds: [],
		syncDeviceIds: [],
		relationshipTypeIds: [],
		relationshipEdgeIds: [],
	}
}

describe("assertNotPackaged", () => {
	test("allows unpackaged env", () => {
		expect(() => assertNotPackaged({})).not.toThrow()
	})

	test("refuses desktop installs", () => {
		expect(() => assertNotPackaged({ HOARDODILE_PACKAGED: "1" })).toThrow(
			/packaged runtime/,
		)
	})
})

describe("inspectSeedRoot", () => {
	test("missing path is empty", () => {
		const root = join(tempRoot(), "missing")
		expect(inspectSeedRoot(root).kind).toBe("empty")
	})

	test("empty directory is seedable", () => {
		const root = tempRoot()
		expect(inspectSeedRoot(root).kind).toBe("empty")
	})

	test("versions without a real sentinel is old", () => {
		const root = tempRoot()
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		expect(() => inspectSeedRoot(root)).toThrow(
			/not an empty official demo library/,
		)
	})

	test("app.sqlite without a real sentinel is old", () => {
		const root = tempRoot()
		writeFileSync(join(root, "app.sqlite"), "")
		expect(() => inspectSeedRoot(root)).toThrow(
			/not an empty official demo library/,
		)
	})

	test("a JSON file named demo-seed.json is not enough", () => {
		const root = tempRoot()
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(
			join(root, "local", "demo-seed.json"),
			`${JSON.stringify({ status: "complete" })}\n`,
		)
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		expect(() => inspectSeedRoot(root)).toThrow(
			/not an empty official demo library/,
		)
	})

	test("a sentinel this CLI wrote is a demo tree", () => {
		const root = tempRoot()
		writeSeedManifestToRoot(root, emptySeedManifest())
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		const state = inspectSeedRoot(root)
		expect(state.kind).toBe("demo")
	})
})

describe("prepareSeedRoot", () => {
	test("writes a kinded in-progress sentinel on an empty dir", () => {
		const root = tempRoot()
		const state = prepareSeedRoot(root, { dryRun: false })
		expect(state.kind).toBe("demo")
		if (state.kind !== "demo") return
		expect(state.manifest.kind).toBe("hoardodile-demo-seed")
		expect(state.manifest.status).toBe("in-progress")
	})

	test("dry-run does not write", () => {
		const root = tempRoot()
		const state = prepareSeedRoot(root, { dryRun: true })
		expect(state.kind).toBe("empty")
		expect(inspectSeedRoot(root).kind).toBe("empty")
	})
})

describe("mixedReasons", () => {
	test("empty library matches an empty sentinel", () => {
		expect(mixedReasons(emptySnapshot(), emptySeedManifest())).toEqual([])
	})

	test("foreign resource ids are mixed", () => {
		const snapshot = { ...emptySnapshot(), resourceIds: ["other"] }
		expect(mixedReasons(snapshot, emptySeedManifest()).join(" ")).toMatch(
			/resource other/,
		)
	})

	test("user_actions footprints are mixed", () => {
		expect(
			mixedReasons(
				{ ...emptySnapshot(), userActionCount: 2 },
				emptySeedManifest(),
			),
		).toEqual(["user_actions"])
	})

	test("a second archive version is mixed", () => {
		expect(
			mixedReasons(
				{ ...emptySnapshot(), versions: [1, 2] },
				emptySeedManifest(),
			),
		).toEqual(["versions 1,2"])
	})
})
