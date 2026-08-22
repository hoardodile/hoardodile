/**
 * @vitest-environment node
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
	defaultDesktopConfig,
	parseDesktopConfig,
	writeDesktopConfig,
} from "./config.ts"

const scratch: string[] = []

afterEach(() => {
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

describe("parseDesktopConfig", () => {
	it("fills defaults for an empty object", () => {
		const parsed = parseDesktopConfig({}, "C:/lib", "C:/docs")
		expect(parsed).toEqual(defaultDesktopConfig("C:/lib", "C:/docs"))
		expect(parsed.autoUpdate).toBe(true)
		expect(parsed.autoStart).toBe(false)
		expect(parsed.startInTray).toBe(false)
		expect(parsed.port).toBe(3000)
		expect(parsed.sharedFolderRoot).toBe("C:/docs")
		expect(parsed.sharedFolderEnabled).toBe(false)
	})

	it("keeps a persisted port, library path, and shared folder", () => {
		const parsed = parseDesktopConfig(
			{
				wizardComplete: true,
				libraryPath: "D:/archive",
				sharedFolderRoot: "E:/import",
				port: 4123,
				autoStart: true,
				startInTray: true,
				autoUpdate: false,
			},
			"C:/lib",
			"C:/docs",
		)
		expect(parsed.libraryPath).toBe("D:/archive")
		expect(parsed.sharedFolderRoot).toBe("E:/import")
		expect(parsed.port).toBe(4123)
		expect(parsed.autoStart).toBe(true)
		expect(parsed.startInTray).toBe(true)
		expect(parsed.autoUpdate).toBe(false)
		expect(parsed.wizardComplete).toBe(true)
		expect(parsed.sharedFolderEnabled).toBe(false)
	})

	it("keeps a persisted sharedFolderEnabled true", () => {
		const parsed = parseDesktopConfig(
			{
				sharedFolderEnabled: true,
			},
			"C:/lib",
			"C:/docs",
		)
		expect(parsed.sharedFolderEnabled).toBe(true)
	})
})

describe("writeDesktopConfig", () => {
	it("round-trips JSON to disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "hd-desktop-"))
		scratch.push(dir)
		const file = join(dir, "desktop.json")
		const config = defaultDesktopConfig("C:/lib", "C:/docs")
		config.wizardComplete = true
		writeDesktopConfig(file, config)
		const raw: unknown = JSON.parse(readFileSync(file, "utf8"))
		expect(raw).toMatchObject({
			wizardComplete: true,
			libraryPath: "C:/lib",
			sharedFolderRoot: "C:/docs",
			sharedFolderEnabled: false,
			port: 3000,
		})
	})
})
