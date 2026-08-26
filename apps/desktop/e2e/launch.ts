import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import getPort from "get-port"
import { _electron, type ElectronApplication, type Page } from "playwright"

const repoRoot = resolve(import.meta.dirname, "..", "..", "..")

export const E2E_PASSWORD = "correct horse battery staple"

/**
 * The app window of the desktop session — the one on the sidecar origin.
 * Throws when it has not appeared yet; together with `expect.poll` in the
 * spec this keeps TS narrowing honest (no `as`).
 */
export function appWindow(app: ElectronApplication, urlPrefix: string): Page {
	const win = app
		.windows()
		.find((candidate) => candidate.url().startsWith(urlPrefix))
	if (win === undefined) {
		throw new Error(`app window missing (expected ${urlPrefix}*)`)
	}
	return win
}

export type DesktopHarness = {
	readonly app: ElectronApplication
	readonly userDataDir: string
	readonly libraryDir: string
	readonly url: string
	close: () => Promise<void>
}

/**
 * Launch the packaged (unpacked) desktop app against a hermetic profile:
 * a throwaway `--user-data-dir`, a throwaway library, a free port and
 * HOARDODILE_E2E=1 (the shell then skips tray + updater — headless CI has
 * no StatusNotifier service and tests must never poll the update feed).
 *
 * `feedBase` switches to the resource-update mode: the updater starts
 * (no HOARDODILE_E2E), the tray stays off, and the resource channel
 * points at the fixture feed — the real check→download→apply path runs
 * against a local HTTP server. `autoUpdate` is forced on so the boot
 * check fires on schedule.
 *
 * `writeConfig` false reuses the profile as the app left it (persisted
 * desktop.json + session cookies), which is what the relaunch check needs.
 */
export async function launchDesktop(
	options: {
		readonly userDataDir?: string
		readonly libraryDir?: string
		readonly writeConfig?: boolean
		readonly feedBase?: string
	} = {},
): Promise<DesktopHarness> {
	const userDataDir =
		options.userDataDir ?? mkdtempSync(join(tmpdir(), "hoardodile-e2e-user-"))
	const libraryDir =
		options.libraryDir ?? mkdtempSync(join(tmpdir(), "hoardodile-e2e-lib-"))
	const port =
		options.writeConfig === false
			? persistedPort(userDataDir)
			: await getPort({ port: 38123 })
	if (options.writeConfig !== false) {
		writeFileSync(
			join(userDataDir, "desktop.json"),
			JSON.stringify(
				{
					wizardComplete: false,
					libraryPath: libraryDir,
					sharedFolderRoot: libraryDir,
					sharedFolderEnabled: false,
					port,
					portPreferred: port,
					lanEnabled: false,
					autoStart: false,
					startInTray: false,
					closeAction: "quit",
					// The relaunch smoke asserts the session cookie survives;
					// the per-launch/first-window sign-in defaults would break that.
					requireSignInOnLaunch: false,
					requireSignInOnWindowOpen: false,
					autoUpdate: options.feedBase !== undefined,
				},
				null,
				"\t",
			),
			"utf8",
		)
	}

	const app = await _electron.launch({
		executablePath: resolveExecutablePath(),
		args: [
			`--user-data-dir=${userDataDir}`,
			...(process.platform === "linux" ? ["--no-sandbox"] : []),
		],
		env: {
			...process.env,
			...(options.feedBase === undefined ? { HOARDODILE_E2E: "1" } : {}),
			...(options.feedBase !== undefined
				? { HOARDODILE_RESOURCE_FEED_BASE: options.feedBase }
				: {}),
			// The wizard defaults to Documents/hoardodile; pin Documents to
			// the throwaway library so its path is deterministic.
			HOARDODILE_E2E_DOCUMENTS: libraryDir,
		},
		timeout: 90_000,
	})

	return {
		app,
		userDataDir,
		libraryDir,
		url: `http://127.0.0.1:${port}/`,
		async close() {
			try {
				await app.close()
			} catch {
				app.process().kill()
			}
		},
	}
}

function persistedPort(userDataDir: string): number {
	const raw: unknown = JSON.parse(
		readFileSync(join(userDataDir, "desktop.json"), "utf8"),
	)
	if (
		typeof raw === "object" &&
		raw !== null &&
		"port" in raw &&
		typeof raw.port === "number"
	) {
		return raw.port
	}
	throw new Error(`no persisted port in ${join(userDataDir, "desktop.json")}`)
}

/** The packaged binary the harness launches (also used by the fixture setup). */
export function resolveExecutablePath(): string {
	const explicit = process.env.DESKTOP_E2E_EXECUTABLE
	if (explicit !== undefined && explicit.length > 0) return explicit
	const releaseRoot = join(repoRoot, "apps", "desktop", "release")
	const relative =
		process.platform === "win32"
			? join("win-unpacked", "Hoardodile.exe")
			: process.platform === "linux"
				? join("linux-unpacked", "hoardodile")
				: join("mac-arm64", "Hoardodile.app", "Contents", "MacOS", "Hoardodile")
	const path = join(releaseRoot, relative)
	if (!existsSync(path)) {
		throw new Error(
			`desktop e2e executable missing: ${path}\n` +
				"Run `pnpm -F @hoardodile/desktop package:dir` first, " +
				"or point DESKTOP_E2E_EXECUTABLE at a packaged binary.",
		)
	}
	return path
}
