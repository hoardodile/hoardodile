/**
 * @vitest-environment node
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	detectInstallShape,
	probeWritable,
	resourceUpdateSupport,
} from "./resource-support.ts"

const scratch: string[] = []

afterEach(() => {
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe("detectInstallShape", () => {
	it("maps runtime facts to install shapes", () => {
		expect(
			detectInstallShape({
				packaged: true,
				portable: false,
				platform: "win32",
			}),
		).toBe("nsis")
		expect(
			detectInstallShape({
				packaged: true,
				portable: true,
				platform: "win32",
			}),
		).toBe("portable")
		expect(
			detectInstallShape({
				packaged: true,
				portable: false,
				platform: "linux",
			}),
		).toBe("appImage")
		expect(
			detectInstallShape({
				packaged: true,
				portable: false,
				platform: "darwin",
			}),
		).toBe("dmg")
		expect(
			detectInstallShape({
				packaged: false,
				portable: false,
				platform: "win32",
			}),
		).toBe("unpackaged")
	})
})

describe("probeWritable", () => {
	it("accepts a writable directory", () => {
		const dir = mkdtempSync(join(tmpdir(), "hd-probe-"))
		scratch.push(dir)
		expect(probeWritable(dir)).toEqual({ available: true })
	})

	it("rejects a path whose parent is a file", () => {
		const dir = mkdtempSync(join(tmpdir(), "hd-probe-"))
		scratch.push(dir)
		const file = join(dir, "resources")
		writeFileSync(file, "x")
		const probe = probeWritable(join(file, "node"))
		expect(probe).toEqual({ available: false, reason: "read-only" })
	})
})

describe("resourceUpdateSupport", () => {
	it("enables the channel on a writable nsis install", () => {
		const dir = mkdtempSync(join(tmpdir(), "hd-probe-"))
		scratch.push(dir)
		expect(
			resourceUpdateSupport({
				packaged: true,
				portable: false,
				platform: "win32",
				resourcesRoot: dir,
			}),
		).toEqual({ available: true })
	})

	it("closes the channel on portable / appimage / dmg / dev shapes", () => {
		const dir = mkdtempSync(join(tmpdir(), "hd-probe-"))
		scratch.push(dir)
		for (const options of [
			{ packaged: true, portable: true, platform: "win32" as const },
			{ packaged: true, portable: false, platform: "linux" as const },
			{ packaged: true, portable: false, platform: "darwin" as const },
			{ packaged: false, portable: false, platform: "win32" as const },
		]) {
			expect(
				resourceUpdateSupport({ ...options, resourcesRoot: dir }).available,
			).toBe(false)
		}
	})
})
