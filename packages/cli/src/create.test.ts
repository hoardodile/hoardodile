import { describe, expect, test } from "vitest"
import { resolveCreateArgs } from "./create.ts"

describe("resolveCreateArgs", () => {
	test("defaults to a bare dlx invocation", () => {
		expect(resolveCreateArgs({})).toEqual([
			"dlx",
			"--yes",
			"create-hoardodile-plugin",
		])
	})

	test("forwards name and tarballs", () => {
		expect(
			resolveCreateArgs({ name: "my-plugin", tarballs: "tmp/sdks" }),
		).toEqual([
			"dlx",
			"--yes",
			"create-hoardodile-plugin",
			"my-plugin",
			"--tarballs",
			"tmp/sdks",
		])
	})

	test("forwards name alone", () => {
		expect(resolveCreateArgs({ name: "my-plugin" })).toEqual([
			"dlx",
			"--yes",
			"create-hoardodile-plugin",
			"my-plugin",
		])
	})
})
