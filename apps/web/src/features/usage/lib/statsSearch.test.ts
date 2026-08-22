/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	buildStatsSearch,
	DEFAULT_STATS_SEARCH,
	normalizeStatsSearch,
} from "./statsSearch"

describe("statsSearch", () => {
	it("defaults exposureMode to direct", () => {
		expect(normalizeStatsSearch({})).toEqual(DEFAULT_STATS_SEARCH)
	})

	it("preserves exposureMode", () => {
		expect(
			normalizeStatsSearch({
				exposureMode: "associated",
			}),
		).toMatchObject({
			exposureMode: "associated",
		})
	})

	it("preserves entityType filter", () => {
		expect(
			normalizeStatsSearch({
				exposureMode: "total",
				entityType: "character",
			}),
		).toEqual({
			range: "last7days",
			platform: "all",
			exposureMode: "total",
			shareMetric: "time",
			entityType: "character",
			sharePage: 1,
		})
	})

	it("defaults shareMetric to time", () => {
		expect(normalizeStatsSearch({})).toMatchObject({
			shareMetric: "time",
		})
	})

	it("preserves shareMetric", () => {
		expect(normalizeStatsSearch({ shareMetric: "views" })).toMatchObject({
			shareMetric: "views",
		})
	})

	it("buildStatsSearch merges exposureMode patches", () => {
		expect(
			buildStatsSearch(DEFAULT_STATS_SEARCH, { exposureMode: "total" }),
		).toMatchObject({
			exposureMode: "total",
		})
	})

	it("buildStatsSearch merges shareMetric patches", () => {
		expect(
			buildStatsSearch(DEFAULT_STATS_SEARCH, { shareMetric: "views" }),
		).toMatchObject({
			shareMetric: "views",
		})
	})
})
