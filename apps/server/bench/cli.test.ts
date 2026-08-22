import { describe, expect, test } from "vitest"
import { printHelp, resolveSuites } from "./cli.ts"
import { archive7zSuite } from "./suites/archive-7z.ts"
import { dbSuite } from "./suites/db.ts"
import { ioSuite } from "./suites/io.ts"
import { ioMicroSuite } from "./suites/io-micro.ts"
import { ioRangeSuite } from "./suites/io-range.ts"
import { pluginSuite } from "./suites/plugin.ts"
import { precacheSuite } from "./suites/precache.ts"

describe("resolveSuites", () => {
	test("no positional returns every suite in canonical order", () => {
		expect(resolveSuites(undefined).map((s) => s.name)).toEqual([
			"io",
			"precache",
			"plugin",
			"db",
			"io-micro",
			"io-range",
			"archive-7z",
		])
	})

	test("a known name resolves to that suite", () => {
		expect(resolveSuites("io")).toEqual([ioSuite])
		expect(resolveSuites("db")).toEqual([dbSuite])
		expect(resolveSuites("io-micro")).toEqual([ioMicroSuite])
		expect(resolveSuites("io-range")).toEqual([ioRangeSuite])
		expect(resolveSuites("precache")).toEqual([precacheSuite])
		expect(resolveSuites("plugin")).toEqual([pluginSuite])
		expect(resolveSuites("archive-7z")).toEqual([archive7zSuite])
	})

	test("an unknown name throws with the available suites", () => {
		expect(() => resolveSuites("nope")).toThrow(
			'unknown suite "nope" — expected one of: io, precache, plugin, db, io-micro, io-range, archive-7z',
		)
	})
})

describe("printHelp", () => {
	test("lists every suite and the shared flags", () => {
		const help = printHelp()
		for (const name of [
			"io",
			"precache",
			"plugin",
			"db",
			"io-micro",
			"io-range",
			"archive-7z",
		]) {
			expect(help).toContain(name)
		}
		for (const flag of [
			"--out=",
			"--seed=",
			"--repeat=",
			"--threshold=",
			"--save",
			"--check",
			"--plugins=",
			"--plugin=",
		]) {
			expect(help).toContain(flag)
		}
	})
})
