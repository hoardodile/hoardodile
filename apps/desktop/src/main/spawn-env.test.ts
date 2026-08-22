/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import type { SidecarLayout } from "./paths.ts"
import { buildSidecarEnv } from "./spawn-env.ts"

const layout: SidecarLayout = {
	packaged: true,
	nodePath: "C:/res/node/node.exe",
	serverArgs: ["--enable-source-maps", "C:/res/server/main.js"],
	cwd: "C:/res/server",
	builtinPath: "C:/res/plugins/file",
	seedPluginPaths: ["C:/res/plugins/gallery"],
}

describe("buildSidecarEnv", () => {
	it("injects loopback host, packaged flag, and absolute paths", () => {
		const env = buildSidecarEnv(
			{
				layout,
				libraryPath: "C:/Users/me/Documents/hoardodile",
				host: "127.0.0.1",
				port: 3000,
				sharedFolderRoot: "D:/imports",
				sharedFolderEnabled: true,
				shutdownToken: "secret-token",
			},
			{ PATH: "C:/Windows/system32", PORT: "9999" },
		)
		expect(env.HOST).toBe("127.0.0.1")
		expect(env.PORT).toBe("3000")
		expect(env.NODE_ENV).toBe("production")
		expect(env.HOARDODILE_PACKAGED).toBe("1")
		expect(env.HOARDODILE_SHUTDOWN_TOKEN).toBe("secret-token")
		expect(env.STORAGE_ROOT).toBe("C:/Users/me/Documents/hoardodile")
		expect(env.SHARED_FOLDER_ROOT).toBe("D:/imports")
		expect(env.APP_WEB_ROOT).toBeUndefined()
		expect(env.DISABLE_DEV_PLUGINS).toBe("true")
		expect(env.SESSION_SECURE_COOKIE).toBe("false")
		expect(env.FORCE_HTTPS).toBe("false")
		expect(env.FFMPEG_PATH).toBeUndefined()
		expect(env.FFPROBE_PATH).toBeUndefined()
		expect(env["7Z_BIN_PATH"]).toBeUndefined()
		expect(env.BUILTIN_PATH).toBe("C:/res/plugins/file")
		expect(env.SEED_PLUGIN_PATHS).toBe("C:/res/plugins/gallery")
		expect(env.PATH).toBe("C:/Windows/system32")
	})

	it("omits SHARED_FOLDER_ROOT when shared-folder import is disabled", () => {
		const env = buildSidecarEnv(
			{
				layout,
				libraryPath: "C:/Users/me/Documents/hoardodile",
				host: "127.0.0.1",
				port: 3000,
				sharedFolderRoot: "D:/imports",
				sharedFolderEnabled: false,
				shutdownToken: "secret-token",
			},
			{ PATH: "C:/Windows/system32" },
		)
		expect(env.SHARED_FOLDER_ROOT).toBeUndefined()
	})

	it("injects the wildcard host when local-network sharing is on", () => {
		const env = buildSidecarEnv(
			{
				layout,
				libraryPath: "C:/Users/me/Documents/hoardodile",
				host: "0.0.0.0",
				port: 3000,
				sharedFolderRoot: "D:/imports",
				sharedFolderEnabled: false,
				shutdownToken: "secret-token",
			},
			{ PATH: "C:/Windows/system32" },
		)
		expect(env.HOST).toBe("0.0.0.0")
	})
})
