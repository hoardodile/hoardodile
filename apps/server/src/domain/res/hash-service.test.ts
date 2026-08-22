import type { Resource } from "@hoardodile/schemas"
import { describe, expect, test } from "vitest"
import {
	buildResHashService,
	hammingDistance,
	isDegenerateHash,
	maxDistanceFor,
	type ResHashServiceDeps,
	SIMILAR_MAX_DISTANCE_BY_TYPE,
	SIMILAR_RESULT_LIMIT,
	SIMILAR_WITHIN_MAX_ROWS,
} from "./hash-service.ts"
import type { ResourceHashRow } from "./repo.ts"

const RES_A = "res-a"
const RES_B = "res-b"
const RES_C = "res-c"

function hashRow(
	resourceId: string,
	scope: string,
	type: string,
	value: string,
	bits: number | null = type === "sha256" ? null : 64,
): ResourceHashRow {
	return {
		resourceId,
		pluginId: "plugin",
		scope,
		type,
		value,
		bits,
	}
}

function resource(id: string): Resource {
	return {
		id,
		name: id,
		intro: "",
		contentPluginId: null,
		tagIds: [],
		charIds: [],
		coverVersion: 1,
		createdAt: 0,
		updatedAt: 0,
		dislikeCount: 0,
		dislikedRecently: false,
	}
}

function buildService(rows: readonly ResourceHashRow[]) {
	const deps: ResHashServiceDeps = {
		listHashes: (resourceId) => rows.filter((r) => r.resourceId === resourceId),
		listHashesOfType: (type, exclude) =>
			rows.filter((r) => r.type === type && r.resourceId !== exclude),
		findExactHashMatches: (type, value, exclude) =>
			rows.filter(
				(r) => r.type === type && r.value === value && r.resourceId !== exclude,
			),
		toResource: (id) => resource(id),
	}
	return buildResHashService(deps)
}

// 64-bit values differing from the zero hash in exactly `distance` low bits.
function hashWithDistance(distance: number): string {
	return ((BigInt(1) << BigInt(distance)) - 1n).toString(16).padStart(16, "0")
}

describe("hammingDistance", () => {
	test("counts differing bits", () => {
		expect(hammingDistance("0000", "0000")).toBe(0)
		expect(hammingDistance("0000", "ffff")).toBe(16)
		expect(hammingDistance("0000000000000001", "0000000000000003")).toBe(1)
		expect(hammingDistance("aaaaaaaaaaaaaaaa", "5555555555555555")).toBe(64)
	})
})

describe("isDegenerateHash", () => {
	test("flags all-zero and all-one hex values", () => {
		expect(isDegenerateHash("0000000000000000")).toBe(true)
		expect(isDegenerateHash("ffffffffffffffff")).toBe(true)
		expect(isDegenerateHash("0")).toBe(true)
		expect(isDegenerateHash("f")).toBe(true)
	})

	test("accepts any value carrying information", () => {
		expect(isDegenerateHash(hashWithDistance(1))).toBe(false)
		expect(isDegenerateHash(hashWithDistance(20))).toBe(false)
		expect(isDegenerateHash("aaaaaaaaaaaaaaaa")).toBe(false)
	})
})

describe("similarImages", () => {
	test("ranks matches by best distance across files", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(1)),
			hashRow(RES_A, "2.jpg", "dhash", hashWithDistance(60)),
			hashRow(RES_B, "page.png", "dhash", hashWithDistance(3)),
			hashRow(RES_B, "other.png", "dhash", hashWithDistance(16)),
			hashRow(RES_C, "x.jpg", "dhash", hashWithDistance(7)),
		])
		const result = service.similarImages(RES_A)
		expect(result.map((entry) => entry.resource.id)).toEqual([RES_B, RES_C])
		// Only within-threshold file pairs are listed; `other.png` (15 bits
		// from the query) is outside the threshold and dropped.
		expect(result[0]?.files).toEqual([
			{ scope: "page.png", bits: 64, distance: 2 },
		])
		expect(result[1]?.files).toEqual([
			{ scope: "x.jpg", bits: 64, distance: 6 },
		])
	})

	test("sorts each entry's files by distance ascending", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(1)),
			hashRow(RES_B, "far.png", "dhash", hashWithDistance(6)),
			hashRow(RES_B, "near.png", "dhash", hashWithDistance(2)),
		])
		const result = service.similarImages(RES_A)
		expect(result[0]?.files.map((f) => f.scope)).toEqual([
			"near.png",
			"far.png",
		])
	})

	test("drops matches beyond the threshold and the resource itself", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(1)),
			hashRow(
				RES_C,
				"far.jpg",
				"dhash",
				// threshold+2 low bits: (threshold+1) bits differ from the
				// query's single low bit.
				hashWithDistance((SIMILAR_MAX_DISTANCE_BY_TYPE.dhash ?? 10) + 2),
			),
		])
		expect(service.similarImages(RES_A)).toEqual([])
	})

	test("applies the per-type threshold (phash tighter than dhash)", () => {
		expect(maxDistanceFor("dhash")).toBe(8)
		expect(maxDistanceFor("phash")).toBe(6)
		expect(maxDistanceFor("custom-kind")).toBe(10)
		const service = buildService([
			hashRow(RES_A, "1.jpg", "phash", hashWithDistance(1)),
			// 7 bits from the query: inside the dhash threshold, outside
			// the phash one.
			hashRow(RES_C, "x.jpg", "phash", hashWithDistance(8)),
		])
		expect(service.similarImages(RES_A)).toEqual([])
	})

	test("skips degenerate query and candidate hashes", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", "0000000000000000"),
			hashRow(RES_B, "2.jpg", "dhash", "0000000000000000"),
			hashRow(RES_C, "3.jpg", "dhash", "ffffffffffffffff"),
		])
		expect(service.similarImages(RES_A)).toEqual([])

		const mixed = buildService([
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(1)),
			hashRow(RES_B, "2.jpg", "dhash", "ffffffffffffffff"),
		])
		expect(mixed.similarImages(RES_A)).toEqual([])
	})

	test("ignores exact hashes and returns empty without perceptual hashes", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "sha256", "ab", null),
			hashRow(RES_B, "1.jpg", "sha256", "ab", null),
		])
		expect(service.similarImages(RES_A)).toEqual([])
	})

	test("folds one file matched by several kinds into a single entry", () => {
		const service = buildService([
			// RES_B's page matches A's cover on both kinds (dhash 1 bit,
			// phash 2 bits apart): one distinct file must stay one entry.
			hashRow(RES_A, "cover.png", "dhash", hashWithDistance(1)),
			hashRow(RES_A, "cover.png", "phash", hashWithDistance(2)),
			hashRow(RES_B, "page.png", "dhash", hashWithDistance(2)),
			hashRow(RES_B, "page.png", "phash", hashWithDistance(4)),
		])
		const result = service.similarImages(RES_A)
		expect(result).toHaveLength(1)
		expect(result[0]?.files).toEqual([
			{ scope: "page.png", bits: 64, distance: 1 },
		])
	})
})

describe("similarWithinResource", () => {
	test("clusters transitively similar files and reports best distances", () => {
		const service = buildService([
			// dhash chain: 1 ↔ 2 (dist 2), 2 ↔ 3 (dist 6) → {1,2,3}.
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(2)),
			hashRow(RES_A, "2.jpg", "dhash", hashWithDistance(4)),
			hashRow(RES_A, "3.jpg", "dhash", hashWithDistance(10)),
			// phash pair sharing 1.jpg merges 4.jpg into the same group.
			hashRow(RES_A, "1.jpg", "phash", hashWithDistance(7)),
			hashRow(RES_A, "4.jpg", "phash", hashWithDistance(6)),
			// Far from everything — stays out.
			hashRow(RES_A, "far.jpg", "dhash", hashWithDistance(20)),
		])
		const result = service.similarWithinResource(RES_A)
		expect(result).toHaveLength(1)
		const scopes = result[0]?.files.map((f) => f.scope)
		expect(scopes).toEqual(["1.jpg", "4.jpg", "2.jpg", "3.jpg"])
		const byScope = new Map(result[0]?.files.map((f) => [f.scope, f]))
		expect(byScope.get("1.jpg")).toEqual({
			scope: "1.jpg",
			bits: 64,
			distance: 1,
		})
		expect(byScope.get("3.jpg")).toEqual({
			scope: "3.jpg",
			bits: 64,
			distance: 6,
		})
	})

	test("returns separate groups for disjoint clusters, larger first", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(2)),
			hashRow(RES_A, "2.jpg", "dhash", hashWithDistance(3)),
			hashRow(RES_A, "3.jpg", "dhash", hashWithDistance(5)),
			hashRow(RES_A, "4.jpg", "dhash", hashWithDistance(16)),
			hashRow(RES_A, "5.jpg", "dhash", hashWithDistance(17)),
		])
		const result = service.similarWithinResource(RES_A)
		expect(result.map((g) => g.files.map((f) => f.scope))).toEqual([
			["1.jpg", "2.jpg", "3.jpg"],
			["4.jpg", "5.jpg"],
		])
	})

	test("ignores degenerate hashes and lone files", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", "0000000000000000"),
			hashRow(RES_A, "2.jpg", "dhash", "ffffffffffffffff"),
			hashRow(RES_A, "3.jpg", "dhash", hashWithDistance(4)),
		])
		expect(service.similarWithinResource(RES_A)).toEqual([])
	})

	test("returns empty without perceptual hashes", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "sha256", "ab", null),
			hashRow(RES_A, "2.jpg", "sha256", "cd", null),
		])
		expect(service.similarWithinResource(RES_A)).toEqual([])
	})

	test("a single file with several perceptual kinds never reports itself", () => {
		// dhash + phash rows of one file force-union into a cluster, but
		// they fold back to a single scope — no similarity group.
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(2)),
			hashRow(RES_A, "1.jpg", "phash", hashWithDistance(7)),
		])
		expect(service.similarWithinResource(RES_A)).toEqual([])
	})

	test("two files carrying several kinds each form one group of two", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", hashWithDistance(2)),
			hashRow(RES_A, "1.jpg", "phash", hashWithDistance(7)),
			hashRow(RES_A, "2.jpg", "dhash", hashWithDistance(3)),
			hashRow(RES_A, "2.jpg", "phash", hashWithDistance(6)),
		])
		const result = service.similarWithinResource(RES_A)
		expect(result).toHaveLength(1)
		expect(result[0]?.files.map((f) => f.scope)).toEqual(["1.jpg", "2.jpg"])
	})

	test("bails out above the row cap", () => {
		const rows = Array.from({ length: SIMILAR_WITHIN_MAX_ROWS + 1 }, (_, i) =>
			hashRow(RES_A, `${i}.jpg`, "dhash", hashWithDistance(1 + (i % 60))),
		)
		expect(buildService(rows).similarWithinResource(RES_A)).toEqual([])
	})
})

describe("duplicateImages", () => {
	test("aggregates exact matches per resource, ranked by count", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "sha256", "aa"),
			hashRow(RES_A, "2.jpg", "sha256", "bb"),
			hashRow(RES_B, "dup1.png", "sha256", "aa"),
			hashRow(RES_B, "dup2.png", "sha256", "bb"),
			hashRow(RES_C, "dup3.png", "sha256", "aa"),
		])
		const result = service.duplicateImages(RES_A)
		expect(result.map((entry) => entry.resource.id)).toEqual([RES_B, RES_C])
		expect(result[0]?.files).toEqual([
			{ scope: "1.jpg", otherScope: "dup1.png", type: "sha256" },
			{ scope: "2.jpg", otherScope: "dup2.png", type: "sha256" },
		])
		expect(result[1]?.files).toEqual([
			{ scope: "1.jpg", otherScope: "dup3.png", type: "sha256" },
		])
	})

	test("skips perceptual hashes", () => {
		const service = buildService([
			hashRow(RES_A, "1.jpg", "dhash", "0000000000000000"),
			hashRow(RES_B, "1.jpg", "dhash", "0000000000000000"),
		])
		expect(service.duplicateImages(RES_A)).toEqual([])
	})
})

describe("similarToQueryHashes", () => {
	// Hamming distance between hashWithDistance(a) and hashWithDistance(b)
	// is |a - b| (their set bits overlap on the shared low range).
	const dhashAt = (distance: number) => ({
		type: "dhash" as const,
		value: hashWithDistance(distance),
	})

	test("ranks resources by best query-candidate distance", () => {
		const service = buildService([
			hashRow(RES_A, "page.png", "dhash", hashWithDistance(1)),
			hashRow(RES_A, "cover.png", "dhash", hashWithDistance(30)),
			hashRow(RES_B, "page.png", "dhash", hashWithDistance(3)),
			hashRow(RES_B, "other.png", "dhash", hashWithDistance(20)),
			hashRow(RES_C, "far.png", "dhash", hashWithDistance(40)),
		])
		const result = service.similarToQueryHashes([dhashAt(1)])
		expect(result.map((match) => match.resourceId)).toEqual([RES_A, RES_B])
		// Each entry keeps the best distance per matched file.
		expect(result[0]?.files.map((f) => f.distance)).toEqual([0])
		expect(result[1]?.files.map((f) => f.distance)).toEqual([2])
	})

	test("compares against every query value of the type", () => {
		const service = buildService([
			hashRow(RES_A, "a.png", "dhash", hashWithDistance(9)),
			hashRow(RES_B, "b.png", "dhash", hashWithDistance(60)),
		])
		const result = service.similarToQueryHashes([dhashAt(60), dhashAt(1)])
		expect(result.map((match) => match.resourceId)).toEqual([RES_B, RES_A])
		expect(result[1]?.files[0]?.distance).toBe(8)
	})

	test("skips degenerate query and candidate values", () => {
		const service = buildService([
			hashRow(RES_A, "flat.png", "dhash", "0000000000000000"),
		])
		expect(
			service.similarToQueryHashes([
				dhashAt(2),
				{ type: "dhash", value: "ffffffffffffffff" },
			]),
		).toEqual([])
		// A degenerate-only query set matches nothing, not every flat image.
		expect(service.similarToQueryHashes([dhashAt(0)])).toEqual([])
	})

	test("applies the per-type threshold and caps the result", () => {
		const service = buildService([
			hashRow(RES_A, "close.png", "dhash", hashWithDistance(5)),
			hashRow(RES_B, "far.png", "dhash", hashWithDistance(14)),
			hashRow(RES_C, "phash-close.png", "phash", hashWithDistance(5)),
		])
		const dhashOnly = service.similarToQueryHashes([dhashAt(5)])
		expect(dhashOnly.map((match) => match.resourceId)).toEqual([RES_A])

		const rows = Array.from({ length: SIMILAR_RESULT_LIMIT + 5 }, (_, i) =>
			hashRow(`res-${i}`, "x.png", "dhash", hashWithDistance(1 + (i % 3))),
		)
		expect(buildService(rows).similarToQueryHashes([dhashAt(1)])).toHaveLength(
			SIMILAR_RESULT_LIMIT,
		)
	})

	test("folds one file matched by several kinds into a single match", () => {
		const service = buildService([
			hashRow(RES_A, "page.png", "dhash", hashWithDistance(3)),
			hashRow(RES_A, "page.png", "phash", hashWithDistance(5)),
		])
		const result = service.similarToQueryHashes([
			dhashAt(1),
			{ type: "phash", value: hashWithDistance(1) },
		])
		expect(result).toHaveLength(1)
		expect(result[0]?.files).toEqual([
			{ scope: "page.png", bits: 64, distance: 2 },
		])
	})
})
