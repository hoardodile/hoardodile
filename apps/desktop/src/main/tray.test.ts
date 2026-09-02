import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { windowIconPath } from "./tray.ts"

vi.mock("electron", () => ({
	app: { getAppPath: vi.fn(() => "/nonexistent-app-path") },
}))

/** `process.platform` is read-only but redefinable; restore it in `finally`. */
function withPlatform(platform: string, fn: () => void): void {
	const original = process.platform
	Object.defineProperty(process, "platform", {
		value: platform,
		configurable: true,
	})
	try {
		fn()
	} finally {
		Object.defineProperty(process, "platform", {
			value: original,
			configurable: true,
		})
	}
}

describe("windowIconPath", () => {
	function fixture(): string {
		const dir = mkdtempSync(join(tmpdir(), "hd-icon-"))
		writeFileSync(join(dir, "icon.ico"), "ico")
		writeFileSync(join(dir, "icon.png"), "png")
		return dir
	}

	it("resolves the .ico window icon on Windows", () => {
		const dir = fixture()
		try {
			withPlatform("win32", () => {
				expect(windowIconPath(dir)).toBe(join(dir, "icon.ico"))
			})
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("resolves the .png window icon on non-Windows platforms", () => {
		const dir = fixture()
		try {
			withPlatform("linux", () => {
				expect(windowIconPath(dir)).toBe(join(dir, "icon.png"))
			})
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it("returns undefined when neither icon file is present", () => {
		const dir = mkdtempSync(join(tmpdir(), "hd-icon-"))
		try {
			withPlatform("win32", () => {
				expect(windowIconPath(dir)).toBeUndefined()
			})
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
