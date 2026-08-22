import { describe, expect, test } from "vitest"
import type { BenchReport } from "./report.ts"
import { dbSuite } from "./suites/db.ts"
import { extractIoMetrics, ioSuite } from "./suites/io.ts"
import { ioMicroSuite } from "./suites/io-micro.ts"
import { ioRangeSuite } from "./suites/io-range.ts"
import {
	extractChurnMetrics,
	extractPluginMetrics,
	pluginSuite,
} from "./suites/plugin.ts"
import { extractPrecacheMetrics, precacheSuite } from "./suites/precache.ts"

const ms = (v: number) => ({ median: v, min: v, max: v })

/** Shared report fields every suite fills. */
const reportBase = (
	kind: string,
	extra: Record<string, unknown>,
): BenchReport => ({
	schema: 1,
	kind,
	timestamp: "t",
	config: {},
	machine: {
		platform: "linux",
		arch: "x64",
		cpus: 2,
		cpuModel: "cpu-a",
		node: "v24",
	},
	caveats: [],
	memoryPeakMb: 1,
	...extra,
})

describe("suite module metadata", () => {
	const cases = [
		{
			suite: ioSuite,
			name: "io",
			flags: ["tiers", "files", "bytes", "pool-noise"],
		},
		{
			suite: precacheSuite,
			name: "precache",
			flags: ["tiers", "chars", "video-ratio", "large-image-ratio"],
		},
		{ suite: pluginSuite, name: "plugin", flags: ["tiers", "files", "churn"] },
		{ suite: dbSuite, name: "db", flags: ["rows", "time"] },
		{ suite: ioMicroSuite, name: "io-micro", flags: ["files", "time"] },
		{
			suite: ioRangeSuite,
			name: "io-range",
			flags: ["mib", "files", "pages", "time"],
		},
	] as const

	for (const { suite, name, flags } of cases) {
		test(`${name}: name, title, flags and checkDefaults are pinned`, () => {
			expect(suite.name).toBe(name)
			expect(suite.title).toMatch(/bench/)
			expect(suite.flagSpecs.map((f) => f.name)).toEqual(flags)
			for (const spec of suite.flagSpecs) {
				expect(spec.description.length).toBeGreaterThan(0)
			}
			expect(suite.checkDefaults).toBeDefined()
		})
	}
})

describe("extractIoMetrics", () => {
	test("flattens the largest tier's summary into the regression metrics", () => {
		const tiers = [
			{
				tier: 100,
				corpus: {},
				reps: [],
				summary: {
					upload: { wallMs: ms(1), itemsPerSec: ms(2), perItemMeanMs: ms(3) },
					archiveStored: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					archiveDeflate: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					detail: { wallMs: ms(1), itemsPerSec: ms(2), perItemMeanMs: ms(3) },
					listCards: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					listFilesCold: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					listFilesWarm: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					byteRangeFirst: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					byteRangeWarm: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					fileRequest: {
						wallMs: ms(1),
						itemsPerSec: ms(2),
						perItemMeanMs: ms(3),
					},
					uploadDetectMs: ms(4),
				},
			},
			{
				tier: 400,
				corpus: {},
				reps: [],
				summary: {
					upload: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					archiveStored: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					archiveDeflate: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					detail: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					listCards: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					listFilesCold: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					listFilesWarm: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					byteRangeFirst: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					byteRangeWarm: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					fileRequest: {
						wallMs: ms(10),
						itemsPerSec: ms(20),
						perItemMeanMs: ms(30),
					},
					uploadDetectMs: ms(40),
				},
			},
		]
		const report = reportBase("io", { tiers })
		const metrics = extractIoMetrics(report)
		expect(metrics.map((m) => [m.name, m.unit])).toEqual([
			["upload.wallMs", "ms"],
			["upload.perItemMeanMs", "ms"],
			["upload.itemsPerSec", "/s"],
			["archiveStored.wallMs", "ms"],
			["archiveDeflate.wallMs", "ms"],
			["detail.perItemMeanMs", "ms"],
			["listCards.perItemMeanMs", "ms"],
			["listFilesCold.perItemMeanMs", "ms"],
			["listFilesWarm.perItemMeanMs", "ms"],
			["byteRangeFirst.perItemMeanMs", "ms"],
			["byteRangeWarm.perItemMeanMs", "ms"],
			["fileRequest.perItemMeanMs", "ms"],
		])
		// Only the largest tier feeds the regression metrics.
		expect(metrics.find((m) => m.name === "upload.wallMs")?.median).toBe(10)
	})

	test("an empty tier list yields no metrics", () => {
		expect(extractIoMetrics(reportBase("io", { tiers: [] }))).toEqual([])
	})
})

describe("extractPluginMetrics / extractChurnMetrics", () => {
	const tier = (withChurn: boolean) => ({
		tier: 20,
		corpus: {},
		reps: [],
		summary: {
			upload: { wallMs: ms(1), perItemMeanMs: ms(2) },
			meta: { wallMs: ms(1), perItemMeanMs: ms(2) },
			listFilesCold: { wallMs: ms(1), perItemMeanMs: ms(2) },
			listFilesWarm: { wallMs: ms(1), perItemMeanMs: ms(2) },
			churn: withChurn ? { wallMs: ms(5), errorLines: ms(0) } : undefined,
		},
	})

	test("per-item means of the largest tier", () => {
		const metrics = extractPluginMetrics(
			reportBase("plugin", { tiers: [tier(false)] }),
		)
		expect(metrics.map((m) => [m.name, m.unit])).toEqual([
			["upload.perItemMeanMs", "ms"],
			["meta.perItemMeanMs", "ms"],
			["listFilesCold.perItemMeanMs", "ms"],
			["listFilesWarm.perItemMeanMs", "ms"],
		])
	})

	test("churn metrics appear only when the summary has a churn phase", () => {
		expect(
			extractChurnMetrics(reportBase("plugin", { tiers: [tier(false)] })),
		).toEqual([])
		expect(
			extractChurnMetrics(reportBase("plugin", { tiers: [tier(true)] })).map(
				(m) => [m.name, m.unit] as const,
			),
		).toEqual([
			["churn.wallMs", "ms"],
			["churn.errorLines", "count"],
		])
	})
})

describe("extractPrecacheMetrics", () => {
	const tier = {
		tier: 50,
		charCount: 10,
		corpus: {},
		reps: [
			{ counters: { covers: { largeRenders: 2, largeReady: 1 } } },
			{ counters: { covers: { largeRenders: 4, largeReady: 4 } } },
		],
		summary: {
			resources: { wallMs: ms(1), itemsPerSec: ms(2), perItemMeanMs: ms(3) },
			characters: { wallMs: ms(1), itemsPerSec: ms(2) },
			coverHit: { wallMs: ms(1), perItemMeanMs: ms(3) },
		},
	}

	test("wall/throughput, the large-cover unavailable rate and peak memory", () => {
		const report = reportBase("precache", { tiers: [tier], memoryPeakMb: 42 })
		const metrics = extractPrecacheMetrics(report)
		expect(metrics.map((m) => [m.name, m.unit] as const)).toEqual([
			["resources.wallMs", "ms"],
			["resources.itemsPerSec", "/s"],
			["resources.perItemMeanMs", "ms"],
			["characters.wallMs", "ms"],
			["characters.itemsPerSec", "/s"],
			["coverHit.perItemMeanMs", "ms"],
			["resources.largeCoverUnavailableRate", "rate"],
			["memoryPeakMb", "MB"],
		])
		// Reps: 1/2 and 0/4 unavailable → rates 0.5 and 0, median 0.5.
		const rate = metrics.find(
			(m) => m.name === "resources.largeCoverUnavailableRate",
		)
		expect(rate?.median).toBe(0.5)
		expect(metrics.find((m) => m.name === "memoryPeakMb")?.median).toBe(42)
	})

	test("an empty tier list yields no metrics", () => {
		expect(
			extractPrecacheMetrics(reportBase("precache", { tiers: [] })),
		).toEqual([])
	})
})
