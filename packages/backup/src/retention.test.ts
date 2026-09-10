import { describe, expect, it } from "vitest"
import { selectExpiredPoints } from "./engine.ts"
import type { RecoveryPoint } from "./types.ts"

const LIBRARY = "0f1d8e2c-3f4a-4b5c-8d6e-7a8b9c0d1e2f"
const OTHER_LIBRARY = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"
let sequence = 0

function point(
	input: Partial<RecoveryPoint> & { createdAt: number; libraryId?: string },
): RecoveryPoint {
	sequence += 1
	const id = `point-${sequence}`
	const libraryId = input.libraryId ?? LIBRARY
	return {
		id,
		snapshotId: sequence.toString(16).padStart(64, "0"),
		name: "",
		note: "",
		kind: "auto",
		pinned: false,
		...input,
		manifest: {
			formatVersion: 1,
			recoveryPointId: id,
			libraryId,
			instanceId: libraryId,
			createdAt: input.createdAt,
			appVersion: "test",
			latestVersion: 1,
			databasePath: "1/checkpoint.sqlite",
			databaseSha256: "a".repeat(64),
			databaseSchema: "test",
			pluginCount: 0,
			manifestSha256: "b".repeat(64),
		},
	}
}

/** Newest first — the order `listRecoveryPoints` produces. */
const newestFirst = (...points: RecoveryPoint[]) =>
	points.slice().sort((a, b) => b.createdAt - a.createdAt)
const expired = (
	points: RecoveryPoint[],
	automatic: number,
	protectedIds: readonly string[] = [],
) =>
	selectExpiredPoints(points, { automatic }, protectedIds).map(
		(entry) => entry.id,
	)

describe("retention selection", () => {
	it("keeps the newest automatic points and expires the rest", () => {
		const points = newestFirst(
			point({ createdAt: 4_000 }),
			point({ createdAt: 3_000 }),
			point({ createdAt: 2_000 }),
			point({ createdAt: 1_000 }),
		)
		expect(expired(points, 3)).toEqual([points[3]?.id])
	})

	it("keeps nothing when the automatic points fit the count", () => {
		const points = newestFirst(
			point({ createdAt: 2_000 }),
			point({ createdAt: 1_000 }),
		)
		expect(expired(points, 3)).toEqual([])
	})

	it("never expires manual or pinned points", () => {
		const points = newestFirst(
			point({ createdAt: 4_000 }),
			point({ createdAt: 3_000 }),
			point({ createdAt: 2_000, kind: "manual" }),
			point({ createdAt: 1_000, pinned: true }),
		)
		expect(expired(points, 1)).toEqual([points[1]?.id])
	})

	it("keeps the newest point even when it is not an automatic one", () => {
		const points = newestFirst(
			point({ createdAt: 5_000, kind: "manual" }),
			point({ createdAt: 4_000 }),
			point({ createdAt: 3_000 }),
			point({ createdAt: 2_000 }),
		)
		expect(expired(points, 2)).toEqual([points[3]?.id])
	})

	it("protects points named by a running operation", () => {
		const protectedPoint = point({ createdAt: 3_000 })
		const points = newestFirst(
			point({ createdAt: 4_000 }),
			protectedPoint,
			point({ createdAt: 2_000 }),
		)
		expect(expired(points, 1, [protectedPoint.id])).toEqual([points[2]?.id])
	})

	it("applies the count per library", () => {
		const points = newestFirst(
			point({ createdAt: 4_000, libraryId: OTHER_LIBRARY }),
			point({ createdAt: 2_000 }),
			point({ createdAt: 1_000 }),
		)
		expect(expired(points, 1)).toEqual([points[2]?.id])
	})
})
