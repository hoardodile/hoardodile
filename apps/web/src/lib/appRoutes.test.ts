/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { collectRoutePaths, type RouteTreeLike } from "./appRoutes"

function route(
	fullPath: string,
	children?: ReadonlyArray<RouteTreeLike> | Record<string, RouteTreeLike>,
): RouteTreeLike {
	return children === undefined ? { fullPath } : { fullPath, children }
}

describe("collectRoutePaths", () => {
	it("walks array and record children, folding trailing slashes", () => {
		const tree = route("/", {
			index: route("/"),
			characters: route("/characters", [
				route("/characters/$id", { index: route("/characters/$id/") }),
				route("/characters/new"),
				route("/characters/"),
			]),
		})
		expect(collectRoutePaths(tree)).toEqual([
			"/",
			"/characters",
			"/characters/$id",
			"/characters/new",
		])
	})

	it("deduplicates the root", () => {
		expect(collectRoutePaths(route("/", { index: route("/") }))).toEqual(["/"])
	})

	it("keeps distinct sibling paths", () => {
		const tree = route("/", [
			route("/settings/about"),
			route("/settings/desktop", { data: route("/settings/data") }),
		])
		expect(collectRoutePaths(tree)).toEqual([
			"/",
			"/settings/about",
			"/settings/desktop",
			"/settings/data",
		])
	})
})
