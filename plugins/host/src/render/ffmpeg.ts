/**
 * Resolve the absolute paths to `ffmpeg` / `ffprobe` for this host.
 *
 * Precedence:
 *   1. Explicit env vars (`FFMPEG_PATH`, `FFPROBE_PATH`).
 *   2. `ffmpeg-static` and `@derhuerst/ffprobe-static` via lazy
 *      `createRequire`, so they stay out of the host tarball. Dev
 *      resolves them from this package's `node_modules`; `pnpm start`
 *      and the desktop sidecar resolve them from the server
 *      `dist/node_modules` copy.
 *   3. A bare command name (`ffmpeg` / `ffprobe`), which lets operators
 *      who have the binaries on PATH still run the server directly.
 */
import { createRequire } from "node:module"

const requireCjs = createRequire(import.meta.url)

export type FfmpegPaths = {
	readonly ffmpeg: string
	readonly ffprobe: string
}

type ResolveDeps = {
	readonly env?: NodeJS.ProcessEnv
	/** Override for tests so they never hit the real module. */
	readonly loadStatic?: () => string | undefined
	/** Override for tests so they never hit the real module. */
	readonly loadStaticFfprobe?: () => string | undefined
}

export function resolveFfmpegPaths(deps: ResolveDeps = {}): FfmpegPaths {
	const env = deps.env ?? process.env
	const ffmpegEnv = env.FFMPEG_PATH
	const ffprobeEnv = env.FFPROBE_PATH
	const staticFfmpeg =
		ffmpegEnv === undefined || ffmpegEnv.length === 0
			? (deps.loadStatic ?? loadInstallerFfmpeg)()
			: undefined
	const ffmpeg =
		ffmpegEnv !== undefined && ffmpegEnv.length > 0
			? ffmpegEnv
			: (staticFfmpeg ?? "ffmpeg")
	const staticFfprobe =
		ffprobeEnv === undefined || ffprobeEnv.length === 0
			? (deps.loadStaticFfprobe ?? loadInstallerFfprobe)()
			: undefined
	const ffprobe =
		ffprobeEnv !== undefined && ffprobeEnv.length > 0
			? ffprobeEnv
			: (staticFfprobe ?? "ffprobe")
	return { ffmpeg, ffprobe }
}

function loadInstallerFfmpeg(): string | undefined {
	return loadInstallerPath("ffmpeg-static")
}

function loadInstallerFfprobe(): string | undefined {
	return loadInstallerPath("@derhuerst/ffprobe-static")
}

function loadInstallerPath(moduleName: string): string | undefined {
	try {
		const mod: unknown = requireCjs(moduleName)
		if (typeof mod === "string" && mod.length > 0) return mod
		if (
			mod !== null &&
			typeof mod === "object" &&
			"path" in mod &&
			typeof (mod as { path: unknown }).path === "string"
		) {
			return (mod as { path: string }).path
		}
		return undefined
	} catch {
		return undefined
	}
}
