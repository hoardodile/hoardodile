import { expect, test } from "vitest"
import { loadEnv, patchSharedFolderRoot } from "./env.ts"

test("loadEnv parses with defaults", () => {
	const env = loadEnv({})
	expect(env.NODE_ENV).toBe("development")
	expect(env.PORT).toBe(3000)
	expect(env.SESSION_COOKIE_NAME).toBe("app_session")
	expect(env.SESSION_TTL_SECONDS).toBe(60 * 60 * 24 * 7)
	expect(env.SESSION_SECURE_COOKIE).toBe(false)
	expect(env.SHARED_FOLDER_ROOT).toBeUndefined()
})

test("loadEnv coerces numeric PORT", () => {
	const env = loadEnv({ PORT: "5173" } satisfies NodeJS.ProcessEnv)
	expect(env.PORT).toBe(5173)
})

test("loadEnv rejects invalid PORT", () => {
	expect(() => loadEnv({ PORT: "99999" } satisfies NodeJS.ProcessEnv)).toThrow(
		/Invalid environment/,
	)
})

test("loadEnv coerces stringy booleans", () => {
	const env = loadEnv({
		SESSION_SECURE_COOKIE: "true",
		FORCE_HTTPS: "1",
		DISABLE_DEV_PLUGINS: "true",
	} satisfies NodeJS.ProcessEnv)
	expect(env.SESSION_SECURE_COOKIE).toBe(true)
	expect(env.FORCE_HTTPS).toBe(true)
	expect(env.DISABLE_DEV_PLUGINS).toBe(true)
})

test("loadEnv security flags default to false", () => {
	const env = loadEnv({})
	expect(env.FORCE_HTTPS).toBe(false)
	expect(env.DISABLE_DEV_PLUGINS).toBe(false)
})

test("loadEnv resolves SHARED_FOLDER_ROOT relative to workspace root", () => {
	const env = loadEnv({ SHARED_FOLDER_ROOT: "plugins/file/dist" })
	expect(env.SHARED_FOLDER_ROOT).toMatch(/plugins[/\\]file[/\\]dist$/)
})

test("loadEnv parses comma-separated plugin path vars to absolute arrays", () => {
	const env = loadEnv({
		DEV_PLUGIN_PATHS: "plugins/a/dist, plugins/b/dist",
		SEED_PLUGIN_PATHS: "plugins/a/dist,C:/dev/plugin-b/dist",
	} satisfies NodeJS.ProcessEnv)
	expect(env.DEV_PLUGIN_PATHS).toHaveLength(2)
	expect(env.DEV_PLUGIN_PATHS[0]).toMatch(/plugins[/\\]a[/\\]dist$/)
	expect(env.DEV_PLUGIN_PATHS[1]).toMatch(/plugins[/\\]b[/\\]dist$/)
	expect(env.SEED_PLUGIN_PATHS).toHaveLength(2)
	// Relative entries resolve against the workspace root; absolute ones
	// pass through unchanged.
	expect(env.SEED_PLUGIN_PATHS[0]).toMatch(/plugins[/\\]a[/\\]dist$/)
	expect(env.SEED_PLUGIN_PATHS[1]).toBe("C:/dev/plugin-b/dist")
})

test("loadEnv defaults plugin path vars to empty arrays", () => {
	const env = loadEnv({})
	expect(env.DEV_PLUGIN_PATHS).toEqual([])
	expect(env.SEED_PLUGIN_PATHS).toEqual([])
})

test("loadEnv defaults auto snapshot vars to enabled / keep 3", () => {
	const env = loadEnv({})
	expect(env.AUTO_SNAPSHOT_ENABLED).toBe(true)
	expect(env.AUTO_SNAPSHOT_KEEP).toBe(3)
	expect(env.MIN_FREE_DISK_BYTES).toBe(5 * 1024 * 1024 * 1024)
})

test("loadEnv defaults the marketplace cache windows to one day", () => {
	const env = loadEnv({})
	expect(env.MARKETPLACE_CACHE_TTL_MS).toBe(24 * 60 * 60_000)
	expect(env.MARKETPLACE_RELEASE_CACHE_TTL_MS).toBe(24 * 60 * 60_000)
	expect(env.MARKETPLACE_RATE_LIMIT_COOLDOWN_MS).toBe(24 * 60 * 60_000)
})

test("loadEnv parses marketplace cache window overrides", () => {
	const env = loadEnv({
		MARKETPLACE_CACHE_TTL_MS: "600000",
		MARKETPLACE_RELEASE_CACHE_TTL_MS: "3600000",
		MARKETPLACE_RATE_LIMIT_COOLDOWN_MS: "7200000",
	} satisfies NodeJS.ProcessEnv)
	expect(env.MARKETPLACE_CACHE_TTL_MS).toBe(600_000)
	expect(env.MARKETPLACE_RELEASE_CACHE_TTL_MS).toBe(3_600_000)
	expect(env.MARKETPLACE_RATE_LIMIT_COOLDOWN_MS).toBe(7_200_000)
})

test("loadEnv rejects a non-positive marketplace cache window", () => {
	expect(() =>
		loadEnv({
			MARKETPLACE_CACHE_TTL_MS: "0",
		} satisfies NodeJS.ProcessEnv),
	).toThrow(/Invalid environment/)
})

test("loadEnv parses auto snapshot overrides", () => {
	const env = loadEnv({
		AUTO_SNAPSHOT_ENABLED: "false",
		AUTO_SNAPSHOT_KEEP: "7",
		MIN_FREE_DISK_BYTES: "1073741824",
	} satisfies NodeJS.ProcessEnv)
	expect(env.AUTO_SNAPSHOT_ENABLED).toBe(false)
	expect(env.AUTO_SNAPSHOT_KEEP).toBe(7)
	expect(env.MIN_FREE_DISK_BYTES).toBe(1_073_741_824)
})

test("loadEnv rejects a non-positive AUTO_SNAPSHOT_KEEP", () => {
	expect(() =>
		loadEnv({ AUTO_SNAPSHOT_KEEP: "0" } satisfies NodeJS.ProcessEnv),
	).toThrow(/Invalid environment/)
})

test("loadEnv in packaged mode keeps absolute paths without a workspace walk", () => {
	const prev = process.env.HOARDODILE_PACKAGED
	process.env.HOARDODILE_PACKAGED = "1"
	try {
		const env = loadEnv({
			STORAGE_ROOT: "C:/tmp/hoard-lib",
			BUILTIN_PATH: "C:/tmp/plugins/file",
		} satisfies NodeJS.ProcessEnv)
		expect(env.STORAGE_ROOT).toBe("C:/tmp/hoard-lib")
		expect(env.BUILTIN_PATH).toBe("C:/tmp/plugins/file")
	} finally {
		if (prev === undefined) delete process.env.HOARDODILE_PACKAGED
		else process.env.HOARDODILE_PACKAGED = prev
	}
})

test("loadEnv passes through HOARDODILE_SHUTDOWN_TOKEN when set", () => {
	const env = loadEnv({
		HOARDODILE_SHUTDOWN_TOKEN: "spawn-secret",
	} satisfies NodeJS.ProcessEnv)
	expect(env.HOARDODILE_SHUTDOWN_TOKEN).toBe("spawn-secret")
})

test("loadEnv leaves HOARDODILE_SHUTDOWN_TOKEN unset by default", () => {
	const env = loadEnv({})
	expect(env.HOARDODILE_SHUTDOWN_TOKEN).toBeUndefined()
})

test("patchSharedFolderRoot writes an absolute path onto the live env", () => {
	const env = loadEnv({ SHARED_FOLDER_ROOT: "plugins/file/dist" })
	patchSharedFolderRoot(env, "C:/imports")
	expect(env.SHARED_FOLDER_ROOT).toBe("C:/imports")
})

test("patchSharedFolderRoot rejects a relative path", () => {
	const env = loadEnv({})
	expect(() => patchSharedFolderRoot(env, "tmp/import")).toThrow(
		/absolute path/,
	)
})

test("patchSharedFolderRoot clears SHARED_FOLDER_ROOT when path is omitted", () => {
	const env = loadEnv({ SHARED_FOLDER_ROOT: "C:/imports" })
	patchSharedFolderRoot(env, undefined)
	expect(env.SHARED_FOLDER_ROOT).toBeUndefined()
})
