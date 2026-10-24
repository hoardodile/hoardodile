import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { defaultDesktopConfig } from "./config.ts"
import { applyLoginItem } from "./ipc.ts"

const { setLoginItemSettings } = vi.hoisted(() => ({
	setLoginItemSettings: vi.fn(),
}))
vi.mock("electron", () => ({
	app: { setLoginItemSettings },
	BrowserWindow: class {},
	dialog: {},
	ipcMain: {},
	Menu: {},
	nativeImage: {},
	shell: {},
}))
afterEach(() => {
	vi.unstubAllEnvs()
	setLoginItemSettings.mockClear()
})

test("an isolated e2e profile does not change OS startup registration", () => {
	vi.stubEnv("HOARDODILE_E2E", "1")
	applyLoginItem(defaultDesktopConfig(join(tmpdir(), "library"), tmpdir()))
	expect(setLoginItemSettings).not.toHaveBeenCalled()
})

test("regular app startup still applies the configured login item", () => {
	vi.stubEnv("HOARDODILE_E2E", "")
	const config = defaultDesktopConfig(join(tmpdir(), "library"), tmpdir())
	applyLoginItem({ ...config, autoStart: true, startInTray: true })
	expect(setLoginItemSettings).toHaveBeenCalledWith({
		openAtLogin: true,
		args: ["--hidden"],
	})
})
