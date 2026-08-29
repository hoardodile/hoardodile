import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve, win32 } from "node:path"
import { fileURLToPath } from "node:url"
import {
	DEFAULT_PLUGIN_EXTRACT_MAX_BYTES,
	DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES,
	PLUGIN_HOOK_HARD_TIMEOUT_MS,
	PLUGIN_WATCHDOG_TIMEOUT_MS,
	PLUGIN_WORKER_MAX_OLD_SPACE_MB,
} from "@hoardodile/host"

import { z } from "zod"

/**
 * Fallback storage root for local development and tests. In production the
 * operator always supplies an explicit
 * `STORAGE_ROOT`; the default here exists so `loadEnv({})` stays ergonomic
 * for unit tests that do not exercise binary storage. Tests that DO
 * exercise storage always pass their own per-test tmpdir.
 */
const DEFAULT_STORAGE_ROOT = resolve(tmpdir(), "app-dev")

/**
 * Desktop / extraResources spawn sets this so the sidecar never looks for a
 * monorepo `.env` or `package.json` walk. All paths in env must be absolute.
 */
function isPackagedRuntime(): boolean {
	return process.env.HOARDODILE_PACKAGED === "1"
}

export { isPackagedRuntime }

/**
 * Resolve the @hoardodile/server package root from this module's URL. Works both
 * when running vite-node against src/ and when the server is bundled to dist/
 * inside the workspace. Packaged dist (no package.json nearby) must not walk.
 */
function resolveServerPackageRoot(): string {
	const here = dirname(fileURLToPath(import.meta.url))
	let current = here
	while (true) {
		try {
			const pkg = JSON.parse(
				readFileSync(join(current, "package.json"), "utf-8"),
			) as { name?: string }
			if (pkg.name === "@hoardodile/server") return current
		} catch {
			// not found here, keep walking
		}
		const parent = dirname(current)
		if (parent === current) {
			throw new Error(
				"Could not locate @hoardodile/server package root from env.ts",
			)
		}
		current = parent
	}
}

/**
 * Resolve the monorepo workspace root from the server package root. All
 * relative paths in environment variables are interpreted against this root
 * in development. Packaged runs resolve relatives against `process.cwd()`
 * instead — the shell injects absolute paths.
 */
export function resolveWorkspaceRoot(): string {
	if (isPackagedRuntime()) return process.cwd()
	if (cachedWorkspaceRoot !== undefined) return cachedWorkspaceRoot
	const serverRoot = resolveServerPackageRoot()
	let current = serverRoot
	while (true) {
		if (existsSync(join(current, "pnpm-workspace.yaml"))) {
			cachedWorkspaceRoot = current
			return current
		}
		const parent = dirname(current)
		if (parent === current) {
			cachedWorkspaceRoot = resolve(serverRoot, "../..")
			return cachedWorkspaceRoot
		}
		current = parent
	}
}

let cachedWorkspaceRoot: string | undefined

/**
 * Load the repository-root `.env` into `process.env`, if present. Shared by
 * the standalone entries (server main, reset CLI) so a `.env`-driven
 * `STORAGE_ROOT` resolves to the same location whether the script runs from
 * `src/` or from the bundled `dist/`. Safe to call when no `.env` exists.
 * Packaged installs have no workspace `.env`; the parent process injects env.
 */
export function loadWorkspaceEnvFile(): void {
	if (isPackagedRuntime()) return
	try {
		process.loadEnvFile(join(resolveWorkspaceRoot(), ".env"))
	} catch {
		// no .env present; rely on already-exported env vars
	}
}

function makeAbsolute(path: string): string {
	// Windows drive-letter paths (e.g. `C:/dev/my-plugin`) must pass through
	// unchanged even when the server runs on a posix platform.
	if (isAbsolute(path) || win32.isAbsolute(path)) return path
	if (isPackagedRuntime()) return resolve(process.cwd(), path)
	return resolve(resolveWorkspaceRoot(), path)
}

function looksLikeFilePath(value: string): boolean {
	return value.includes("/") || value.includes("\\")
}

/** One day in milliseconds — the default plugin-marketplace cache windows. */
const DAY_MS = 24 * 60 * 60_000

const envSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		HOST: z.string().min(1).default("127.0.0.1"),
		PORT: z.coerce.number().int().min(1).max(65535).default(3000),
		/**
		 * Override the directory of pre-built web assets to serve at `/`.
		 */
		APP_WEB_ROOT: z.string().min(1).optional(),
		LOG_LEVEL: z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
			.default("info"),
		/**
		 * Optional override; only used by tests that need an in-memory DB
		 * (`:memory:`). In real deployments the DB path is derived at
		 * runtime from `STORAGE_ROOT` as `<STORAGE_ROOT>/app.sqlite`.
		 * The live runtime DB lives in the storage root (not inside
		 * `versions/`) so syncing `versions/` to other devices cannot corrupt
		 * the in-use database.
		 */
		DATABASE_URL: z.string().min(1).optional(),
		STORAGE_ROOT: z.string().min(1).default(DEFAULT_STORAGE_ROOT),
		/**
		 * Root directory for shared-folder browsing during folder import.
		 * This is the "Shared Folder" shown in the upload UI; it is unrelated to
		 * the versioned `{storage}/versions/<v>/` archive partitions. The user
		 * navigates subdirectories starting from this path. When omitted,
		 * shared-folder import is disabled and only zip-file import remains
		 * available.
		 */
		SHARED_FOLDER_ROOT: z.string().min(1).optional(),
		SESSION_COOKIE_NAME: z.string().min(1).default("app_session"),
		SESSION_TTL_SECONDS: z.coerce
			.number()
			.int()
			.positive()
			.default(60 * 60 * 24 * 7),
		SESSION_SECURE_COOKIE: z
			.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
			.transform((v) =>
				typeof v === "boolean" ? v : v === "true" || v === "1",
			)
			.default(false),
		/**
		 * When true, the server refuses to issue or refresh session cookies over
		 * plain HTTP and forces the Secure flag. Use when running behind a TLS
		 * terminating reverse proxy to prevent cookie downgrade attacks.
		 */
		FORCE_HTTPS: z
			.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
			.transform((v) =>
				typeof v === "boolean" ? v : v === "true" || v === "1",
			)
			.default(false),
		/**
		 * Shared secret for desktop sidecar control routes (`POST
		 * /api/internal/shutdown`, `POST /api/internal/shared-folder`).
		 * The desktop shell injects a per-spawn value. Unset on self-host:
		 * the routes still exist and every request is 401.
		 */
		HOARDODILE_SHUTDOWN_TOKEN: z.string().min(1).optional(),
		/**
		 * When true, dev plugin directories (DEV_PLUGIN_PATHS) are ignored.
		 * Recommended for public-facing deployments where arbitrary disk plugins
		 * would widen the attack surface.
		 */
		DISABLE_DEV_PLUGINS: z
			.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
			.transform((v) =>
				typeof v === "boolean" ? v : v === "true" || v === "1",
			)
			.default(false),
		/**
		 * Upper bound on a single resource upload, in bytes. Defaults to 2 GiB
		 * -- large enough for typical video originals, small enough that a
		 * runaway client does not fill the disk before hitting the limit.
		 */
		MAX_UPLOAD_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(16 * 1024 * 1024 * 1024),
		/**
		 * Hard cap on the cumulative bytes written to disk when extracting an
		 * archive upload. Defends against zip bombs whose compressed size
		 * fits inside `MAX_UPLOAD_BYTES` but whose uncompressed payload
		 * would exhaust the disk. Defaults to 8 GiB (4× MAX_UPLOAD_BYTES).
		 */
		MAX_ARCHIVE_EXTRACTED_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(64 * 1024 * 1024 * 1024),
		/**
		 * Hard cap on the cumulative uncompressed bytes one
		 * `extractArchive` call (a plugin materializing a container
		 * entry, e.g. a comic archive, for browser rendering) may write to
		 * the extraction cache. Defends against oversized archives
		 * exhausting the disk; defaults to 8 GiB.
		 */
		MAX_PLUGIN_EXTRACT_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(DEFAULT_PLUGIN_EXTRACT_MAX_BYTES),
		/**
		 * Hard cap on the entry count one `extractArchive` call may
		 * materialize. Prevents a degenerate archive (millions of tiny
		 * entries) from exhausting the filesystem's inode budget.
		 */
		MAX_PLUGIN_EXTRACT_ENTRIES: z.coerce
			.number()
			.int()
			.positive()
			.default(DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES),
		/**
		 * Upper bound on a plugin upload, in bytes -- applied both to the
		 * compressed zip payload and to the cumulative extracted size. Plugin
		 * packages are a few source files plus assets, so anything near this
		 * bound is almost certainly abuse (e.g. a zip bomb). Defaults to
		 * 256 MiB.
		 */
		PLUGIN_UPLOAD_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(256 * 1024 * 1024),
		/**
		 * Optional overrides for the `ffmpeg` / `ffprobe` binaries. When
		 * unset, `ffmpeg-static` / `@derhuerst/ffprobe-static` (dev: host
		 * `node_modules`; `pnpm start` / desktop: server `dist/node_modules`)
		 * or PATH resolve them instead, so neither CI nor a fresh clone
		 * needs extra setup.
		 */
		FFMPEG_PATH: z.string().min(1).optional(),
		FFPROBE_PATH: z.string().min(1).optional(),
		/**
		 * Path to the directory containing the builtin content plugin
		 * (manifest.json + main.js + render.js). Defaults to the built-in
		 * fallback plugin under `plugins/file/dist`.
		 */
		BUILTIN_PATH: z.string().min(1).default("plugins/file/dist"),
		/**
		 * Comma-separated paths to dev content plugin directories.
		 * Loaded directly from disk without copying into the versioned
		 * plugins directory.
		 */
		DEV_PLUGIN_PATHS: z
			.preprocess(
				(val) =>
					typeof val === "string" && val.length > 0
						? val
								.split(",")
								.map((s) => s.trim())
								.filter((s) => s.length > 0)
						: [],
				z.array(z.string()),
			)
			.default([]),
		/**
		 * Comma-separated paths to plugin directories (each with
		 * manifest.json at its root) that are seeded into
		 * `{storage}/versions/<latest>/plugins/` on every plugin load
		 * when the destination tree differs, so the plugin behaves like
		 * a regular installed one (DB settings, asset caching, uninstall).
		 * Relative paths resolve against the workspace root. Desktop
		 * seeds the bundled gallery this way; leaving this empty is the
		 * default for a bare server.
		 */
		SEED_PLUGIN_PATHS: z
			.preprocess(
				(val) =>
					typeof val === "string" && val.length > 0
						? val
								.split(",")
								.map((s) => s.trim())
								.filter((s) => s.length > 0)
						: [],
				z.array(z.string()),
			)
			.default([]),
		/**
		 * Plugin sandbox watchdog: kill a plugin worker when an invocation
		 * neither returns nor shows resource-API activity for this long.
		 * Hooks that keep calling the API (e.g. probing thousands of files)
		 * reset the watchdog continuously and never trip it.
		 */
		PLUGIN_WATCHDOG_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(PLUGIN_WATCHDOG_TIMEOUT_MS),
		/**
		 * Absolute cap for a single plugin hook invocation, regardless of
		 * activity. Backstop for "slow but not hung" pathological hooks.
		 */
		PLUGIN_HOOK_HARD_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(PLUGIN_HOOK_HARD_TIMEOUT_MS),
		/**
		 * V8 old-generation memory cap per plugin worker, in MiB. Exceeding
		 * it aborts the worker; the plugin respawns lazily on the next call.
		 */
		PLUGIN_WORKER_MAX_OLD_SPACE_MB: z.coerce
			.number()
			.int()
			.positive()
			.default(PLUGIN_WORKER_MAX_OLD_SPACE_MB),
		/**
		 * Per-file cap for one user-consented plugin asset download, in
		 * bytes. The download stream is aborted as soon as the cap is
		 * crossed, so a hostile server cannot push an unbounded body.
		 */
		PLUGIN_DOWNLOAD_MAX_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(200 * 1024 * 1024),
		/**
		 * Cumulative cap for one plugin's asset vault, in bytes. A
		 * misbehaving plugin cannot fill the disk; re-downloads replace
		 * their target and never count the old bytes twice.
		 */
		PLUGIN_DOWNLOAD_MAX_TOTAL_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(1024 * 1024 * 1024),
		/**
		 * How long a pending consent ticket stays open, in ms. No answer
		 * within this window auto-denies (`DENIED`) and tells every tab to
		 * close its dialog entry.
		 */
		PLUGIN_DOWNLOAD_CONSENT_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(120_000),
		/**
		 * Allow plugin downloads to reach private / loopback / link-local
		 * addresses (e.g. a plugin pulling from a LAN NAS). Off by default:
		 * the downloader blocks the RFC1918/ranges at resolve time and
		 * pins connections to vetted public addresses instead.
		 */
		PLUGIN_DOWNLOAD_ALLOW_PRIVATE: z
			.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
			.transform((v) =>
				typeof v === "boolean" ? v : v === "true" || v === "1",
			)
			.default(false),
		/**
		 * How long the plugin-marketplace catalog snapshot is served from
		 * memory before it is rebuilt. Defaults to a day: the raw
		 * `registry.json`/`manifest.json` fetches are unquota'd, but the
		 * whole snapshot rebuild re-reads every manifest, so a long window
		 * keeps repeated catalog opens cheap.
		 */
		MARKETPLACE_CACHE_TTL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(DAY_MS),
		/**
		 * How long one repo's `releases/latest` payload is trusted (and
		 * persisted to disk). This is the ONLY quota-hungry call (60/hour
		 * unauthenticated per IP), so the release layer is cached
		 * independently from the snapshot layer. Defaults to a day.
		 */
		MARKETPLACE_RELEASE_CACHE_TTL_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(DAY_MS),
		/**
		 * After a GitHub 403/429, skip the API for this long per repo.
		 * Defaults to a day so a rate-limited catalog entry does not keep
		 * retrying the API on every rebuild.
		 */
		MARKETPLACE_RATE_LIMIT_COOLDOWN_MS: z.coerce
			.number()
			.int()
			.positive()
			.default(DAY_MS),
		/**
		 * Explicit outbound proxy for plugin downloads and the plugin
		 * marketplace, e.g. `http://127.0.0.1:7897` (only `http://`
		 * proxies are supported). Overrides the standard
		 * `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` env vars and the OS
		 * system proxy; `off` disables proxy use entirely. Unset →
		 * auto-detect (proxy env vars, then the OS system proxy: Windows
		 * Internet Settings, macOS `scutil`). `NO_PROXY` / the system
		 * override list keep those hosts on the direct path.
		 */
		HOARDODILE_PROXY: z
			.string()
			.max(300)
			.refine(
				(value) => {
					const trimmed = value.trim()
					if (trimmed.length === 0) return true
					if (trimmed.toLowerCase() === "off") return true
					const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
						? trimmed
						: `http://${trimmed}`
					try {
						return new URL(withScheme).protocol === "http:"
					} catch {
						return false
					}
				},
				{ message: "HOARDODILE_PROXY must be an http:// proxy URL or 'off'" },
			)
			.optional(),
		/**
		 * When true, the background scheduler takes an automatic snapshot of
		 * the live DB once per local day (with a catch-up run at boot when
		 * the newest snapshot is stale) into
		 * `{storage}/versions/<v>/snapshots/`, keeping only the
		 * `AUTO_SNAPSHOT_KEEP` newest files.
		 */
		AUTO_SNAPSHOT_ENABLED: z
			.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
			.transform((v) =>
				typeof v === "boolean" ? v : v === "true" || v === "1",
			)
			.default(true),
		/**
		 * Rolling-window size for automatic snapshots: how many distinct
		 * days of `auto-*.sqlite` files to keep in the current version's
		 * `snapshots/` folder.
		 */
		AUTO_SNAPSHOT_KEEP: z.coerce.number().int().min(1).default(3),
		/**
		 * Low-disk guard: when the storage volume has less than this many
		 * free bytes, automatic snapshots are skipped (a full disk would
		 * fail the VACUUM INTO mid-write) and the storage overview flags
		 * the volume as low on space.
		 */
		MIN_FREE_DISK_BYTES: z.coerce
			.number()
			.int()
			.positive()
			.default(5 * 1024 * 1024 * 1024),
		/**
		 * When true, the first-run tag/namespace dedupe only logs what it
		 * would merge (dry-run): no data changes, no run recorded. Use it
		 * to preview the merge list for release notes before upgrading.
		 */
		TAG_DEDUPE_DRY_RUN: z
			.union([z.boolean(), z.enum(["true", "false", "1", "0"])])
			.transform((v) =>
				typeof v === "boolean" ? v : v === "true" || v === "1",
			)
			.default(false),
	})
	.transform((data) => {
		const storageRoot = makeAbsolute(data.STORAGE_ROOT)
		return {
			...data,
			STORAGE_ROOT: storageRoot,
			DATABASE_URL:
				data.DATABASE_URL === ":memory:"
					? data.DATABASE_URL
					: makeAbsolute(data.DATABASE_URL ?? join(storageRoot, "app.sqlite")),
			SHARED_FOLDER_ROOT:
				data.SHARED_FOLDER_ROOT !== undefined
					? makeAbsolute(data.SHARED_FOLDER_ROOT)
					: data.SHARED_FOLDER_ROOT,
			APP_WEB_ROOT:
				data.APP_WEB_ROOT !== undefined
					? makeAbsolute(data.APP_WEB_ROOT)
					: data.APP_WEB_ROOT,
			BUILTIN_PATH: makeAbsolute(data.BUILTIN_PATH),
			DEV_PLUGIN_PATHS: data.DEV_PLUGIN_PATHS.map(makeAbsolute),
			SEED_PLUGIN_PATHS: data.SEED_PLUGIN_PATHS.map(makeAbsolute),
			FFMPEG_PATH:
				data.FFMPEG_PATH !== undefined && looksLikeFilePath(data.FFMPEG_PATH)
					? makeAbsolute(data.FFMPEG_PATH)
					: data.FFMPEG_PATH,
			FFPROBE_PATH:
				data.FFPROBE_PATH !== undefined && looksLikeFilePath(data.FFPROBE_PATH)
					? makeAbsolute(data.FFPROBE_PATH)
					: data.FFPROBE_PATH,
		}
	})

export type Env = z.infer<typeof envSchema>

/**
 * Live-patch the shared-folder import root. Desktop Settings calls this
 * through `POST /api/internal/shared-folder` so folder import picks up a
 * new path without restarting the sidecar. Pass `undefined` to clear it
 * (shared-folder import disabled). Relative paths are rejected: the
 * caller (Electron) always sends an absolute directory.
 */
export function patchSharedFolderRoot(
	env: Env,
	path: string | undefined,
): void {
	if (path === undefined) {
		env.SHARED_FOLDER_ROOT = undefined
		return
	}
	if (path.length === 0) {
		throw new Error("SHARED_FOLDER_ROOT must be a non-empty absolute path")
	}
	if (!(isAbsolute(path) || win32.isAbsolute(path))) {
		throw new Error("SHARED_FOLDER_ROOT must be an absolute path")
	}
	env.SHARED_FOLDER_ROOT = makeAbsolute(path)
}

/**
 * Parse a process-env-like record into a validated {@link Env}.
 *
 * All relative file/directory paths are resolved against the monorepo
 * workspace root so behaviour does not depend on the process cwd. Packaged
 * runs (`HOARDODILE_PACKAGED=1`) skip that walk; the caller supplies
 * absolute paths.
 *
 * @throws `Error` (aggregated message) when one or more fields fail validation.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const parsed = envSchema.safeParse(source)
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("\n")
		throw new Error(`Invalid environment:\n${issues}`)
	}
	return parsed.data
}
