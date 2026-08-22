import { resolve } from "node:path"
import { describe, expect, test } from "vitest"
import {
	type FlagSpec,
	intArg,
	intListArg,
	numberArg,
	parseCommonArgs,
	parseSuiteArgs,
	type SuiteArgs,
} from "./args.ts"
import { REPO_ROOT } from "./harness.ts"

describe("parseCommonArgs", () => {
	test("defaults", () => {
		expect(parseCommonArgs([])).toEqual({
			out: "baseline.json",
			seed: 42,
			repeat: 3,
			thresholdPercent: 25,
			save: false,
			check: false,
			plugins: "stub",
			plugin: undefined,
		})
	})

	test("defaultPlugins option applies when --plugins is absent", () => {
		expect(parseCommonArgs([], { defaultPlugins: "real" }).plugins).toBe("real")
		expect(
			parseCommonArgs(["--plugins=stub"], { defaultPlugins: "real" }).plugins,
		).toBe("stub")
	})

	test("parses every shared flag", () => {
		const args = parseCommonArgs([
			"--out=report.json",
			"--seed=7",
			"--repeat=2",
			"--threshold=10",
			"--save",
			"--check",
			"--plugins=real",
			"--plugin=plugins/file/dist",
		])
		expect(args.out).toBe("report.json")
		expect(args.seed).toBe(7)
		expect(args.repeat).toBe(2)
		expect(args.thresholdPercent).toBe(10)
		expect(args.save).toBe(true)
		expect(args.check).toBe(true)
		expect(args.plugins).toBe("real")
		expect(args.plugin).toBe(resolve(REPO_ROOT, "plugins/file/dist"))
	})

	test("--plugin resolves relative to the repo root", () => {
		const args = parseCommonArgs([
			"--plugins=real",
			"--plugin=some/plugin/dist",
		])
		expect(args.plugin).toBe(resolve(REPO_ROOT, "some/plugin/dist"))
	})

	test("--repeat must be a positive integer", () => {
		for (const bad of ["0", "-1", "2.5", "abc"]) {
			expect(() => parseCommonArgs([`--repeat=${bad}`])).toThrow(
				"--repeat must be a positive integer",
			)
		}
	})

	test("--threshold must be a non-negative number", () => {
		for (const bad of ["-1", "abc"]) {
			expect(() => parseCommonArgs([`--threshold=${bad}`])).toThrow(
				"--threshold must be a non-negative number",
			)
		}
		expect(parseCommonArgs(["--threshold=0"]).thresholdPercent).toBe(0)
	})

	test("--plugins must be stub or real", () => {
		expect(() => parseCommonArgs(["--plugins=host"])).toThrow(
			"--plugins must be stub|real",
		)
	})

	test("--plugin is only meaningful with --plugins=real", () => {
		expect(() => parseCommonArgs(["--plugin=dist"])).toThrow(
			"--plugin is only meaningful with --plugins=real",
		)
	})

	test("--check/--save apply the suite checkDefaults repeat when not explicit", () => {
		const checkDefaults = { repeat: "2" }
		expect(parseCommonArgs([], { checkDefaults }).repeat).toBe(3)
		expect(parseCommonArgs(["--check"], { checkDefaults }).repeat).toBe(2)
		expect(parseCommonArgs(["--save"], { checkDefaults }).repeat).toBe(2)
		expect(
			parseCommonArgs(["--check", "--repeat=5"], { checkDefaults }).repeat,
		).toBe(5)
	})
})

describe("parseSuiteArgs", () => {
	const specs: readonly FlagSpec[] = [
		{ name: "tiers", kind: "intList", description: "", default: [100, 400] },
		{ name: "files", kind: "int", description: "", default: 10 },
		{ name: "ratio", kind: "number", description: "", default: 0.15 },
	]
	const checkDefaults = { tiers: "20", files: "5" }

	test("uses spec defaults when nothing is given", () => {
		expect(parseSuiteArgs([], specs, undefined, false)).toEqual({
			tiers: [100, 400],
			files: 10,
			ratio: 0.15,
		})
	})

	test("explicit flags win over defaults", () => {
		expect(
			parseSuiteArgs(["--tiers=50,200", "--files=3"], specs, undefined, false),
		).toEqual({
			tiers: [50, 200],
			files: 3,
			ratio: 0.15,
		})
	})

	test("checkDefaults apply only when the run is a check/save", () => {
		expect(parseSuiteArgs([], specs, checkDefaults, false)).toEqual({
			tiers: [100, 400],
			files: 10,
			ratio: 0.15,
		})
		expect(parseSuiteArgs([], specs, checkDefaults, true)).toEqual({
			tiers: [20],
			files: 5,
			ratio: 0.15,
		})
	})

	test("explicit flags beat checkDefaults", () => {
		expect(
			parseSuiteArgs(["--files=9"], specs, checkDefaults, true).files,
		).toBe(9)
	})

	test("the last occurrence of a flag wins", () => {
		expect(
			parseSuiteArgs(["--files=3", "--files=7"], specs, undefined, false).files,
		).toBe(7)
	})

	test("intList drops invalid entries but rejects an empty result", () => {
		expect(
			parseSuiteArgs(["--tiers=10,abc,0,30"], specs, undefined, false).tiers,
		).toEqual([10, 30])
		expect(() =>
			parseSuiteArgs(["--tiers=abc"], specs, undefined, false),
		).toThrow("no valid integers parsed from --tiers=")
	})

	test("int and number flags validate their input", () => {
		expect(() =>
			parseSuiteArgs(["--files=2.5"], specs, undefined, false),
		).toThrow("--files must be an integer")
		expect(() =>
			parseSuiteArgs(["--ratio=abc"], specs, undefined, false),
		).toThrow("--ratio must be a number")
	})
})

describe("typed arg accessors", () => {
	const args: SuiteArgs = { tiers: [10, 20], files: 5, ratio: 0.5 }

	test("intArg/intListArg/numberArg read typed values", () => {
		expect(intListArg(args, "tiers")).toEqual([10, 20])
		expect(intArg(args, "files")).toBe(5)
		expect(numberArg(args, "ratio")).toBe(0.5)
	})

	test("missing or wrong-typed args throw", () => {
		expect(() => intArg(args, "nope")).toThrow("missing int flag --nope")
		expect(() => intListArg(args, "files")).toThrow(
			"missing int-list flag --files",
		)
		expect(() => numberArg(args, "nope")).toThrow("missing number flag --nope")
	})
})
