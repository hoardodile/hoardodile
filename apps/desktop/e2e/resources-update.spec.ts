import { createHash } from "node:crypto"
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { expect, test } from "@playwright/test"
import * as tar from "tar"
import {
	contentHashTree,
	SHELL_HASH_BOUNDARY,
} from "../../../scripts/lib/shell-hash.mjs"
import {
	expectShellRendered,
	navigateInShell,
	openShellContent,
} from "./app-shell.ts"
import {
	appWindow,
	E2E_PASSWORD,
	launchDesktop,
	resolveExecutablePath,
} from "./launch.ts"

/**
 * Full resource-channel path against a LOCAL fixture feed:
 *
 *   1. the fixture manifest claims v9.9.9 with the SAME shellHash as this
 *      build (computed from out/, the identical content the installed
 *      asar carries) → the client must route to the resource channel;
 *   2. every layer identity matches the installed tree except
 *      `server-dist` → exactly one layer is downloaded (the fixture
 *      serves a real tarball of the installed server minus node_modules);
 *   3. wizard → claim → banner "resources ready" → apply → the sidecar
 *      stops, the tree swaps, the sidecar restarts, the window reloads
 *      with the session intact;
 *   4. assert: overlay phases ran, `/health` is back, the on-disk marker
 *      and desktop.json resourceVersion say v9.9.9, the library is
 *      untouched.
 *
 * The resource channel is a Windows NSIS-only capability by policy
 * (INSTALL_POLICY in apps/desktop/src/main/resource-support.ts — dmg and
 * AppImage shapes route to the full updater instead), so the whole file
 * is skipped elsewhere: channel-policy coverage lives in the unit tests
 * (resource-support.test.ts), packaged-app coverage in launch.spec.ts.
 *
 * Requires `pnpm -F @hoardodile/desktop package:dir` first (the staged
 * tree + out/ + the packaged app this harness launches).
 */

// Channel policy (see the header): NSIS installs are Windows-only.
test.skip(
	process.platform !== "win32",
	"the resource channel is Windows NSIS-only (INSTALL_POLICY)",
)

const FIXTURE_VERSION = "9.9.9"

let server: Server | undefined
let baseUrl = ""
let fixtureDir = ""
let resourcesDir = ""
/** The pristine installer marker version (restored in beforeAll). */
let installedMarkerVersion = ""

function feedSlug(): string {
	if (process.platform === "win32") return "win"
	if (process.platform === "linux") return "linux"
	return "mac"
}

function packagedResourcesDir(): string {
	const repoRoot = resolve(import.meta.dirname, "..", "..", "..")
	const releaseRoot = join(repoRoot, "apps", "desktop", "release")
	const relative =
		process.platform === "win32"
			? join("win-unpacked", "resources")
			: process.platform === "linux"
				? join("linux-unpacked", "resources")
				: join("mac-arm64", "Hoardodile.app", "Contents", "Resources")
	const dir = join(releaseRoot, relative)
	if (!existsSync(join(dir, "server", "main.js"))) {
		throw new Error(
			`packaged resources missing at ${dir} — run "pnpm -F @hoardodile/desktop package:dir" first`,
		)
	}
	return dir
}

test.beforeAll(async () => {
	// Skipped platforms never run a test — keep the fixture build off them.
	if (process.platform !== "win32") return
	const repoRoot = resolve(import.meta.dirname, "..", "..", "..")
	const desktopRoot = join(repoRoot, "apps", "desktop")
	resourcesDir = packagedResourcesDir()
	fixtureDir = mkdtempSync(join(tmpdir(), "hd-resource-fixture-"))
	const slug = feedSlug()
	const arch = process.arch

	// Repeatability: a previous run's apply replaced the marker (the tree
	// content itself is identical, but the marker decides freshness) —
	// restore the installer's marker from the staged build input and drop
	// any swap leftovers.
	for (const name of [".swap-pending", ".olds"]) {
		rmSync(join(resourcesDir, name), { recursive: true, force: true })
	}
	for (const name of readdirSync(resourcesDir)) {
		if (name.startsWith(".staging-")) {
			rmSync(join(resourcesDir, name), { recursive: true, force: true })
		}
	}
	writeFileSync(
		join(resourcesDir, "resources-version.json"),
		readFileSync(
			join(desktopRoot, "extra-resources", "resources-version.json"),
			"utf8",
		),
	)
	installedMarkerVersion = JSON.parse(
		readFileSync(join(resourcesDir, "resources-version.json"), "utf8"),
	).version

	// The installed shell's identity: content hash of out/ — the same
	// bytes the packaged asar carries, over the same shell-runtime boundary
	// the client hashes (installedShellHash)/the pack builder emits, so the
	// fixture routes to the resource channel rather than the full updater.
	const shellHash = await contentHashTree(
		join(desktopRoot, "out"),
		SHELL_HASH_BOUNDARY,
	)
	const installedMarker = JSON.parse(
		readFileSync(join(resourcesDir, "resources-version.json"), "utf8"),
	)

	const layers = []
	const layerSpecs = [
		{ name: "node", root: ["node"], exclude: [] },
		{ name: "server-dist", root: ["server"], exclude: ["node_modules"] },
		{
			name: "server-node_modules",
			root: ["server", "node_modules"],
			exclude: [],
		},
		{ name: "plugins", root: ["plugins"], exclude: [] },
	]
	for (const spec of layerSpecs) {
		const identity = await contentHashTree(join(resourcesDir, ...spec.root), {
			excludePrefixes: spec.exclude,
		})
		if (spec.name === "server-dist") {
			// The one layer the client must download: built from the same
			// installed tree (minus node_modules), but the manifest claims
			// a DIFFERENT identity so the client cannot skip it.
			const fileName = `resources-layer-${slug}-${arch}-server-dist.tar.gz`
			const payloadPath = join(fixtureDir, fileName)
			await tar.c(
				{
					gzip: true,
					file: payloadPath,
					cwd: resourcesDir,
					filter: (path) =>
						path !== "server/node_modules" &&
						!path.startsWith("server/node_modules/"),
				},
				["server"],
			)
			const digest = createHash("sha256")
				.update(readFileSync(payloadPath))
				.digest("hex")
			layers.push({
				name: spec.name,
				identity: `sha256:${"0".repeat(64)}`,
				payload: {
					fileName,
					sha256: digest,
					size: statSync(payloadPath).size,
				},
			})
		} else {
			// Copied layers are never fetched — payload fields stay unused.
			layers.push({
				name: spec.name,
				identity,
				payload: {
					fileName: `unused-${spec.name}.tar.gz`,
					sha256: "0".repeat(64),
					size: 0,
				},
			})
		}
	}

	const electronVersion = JSON.parse(
		readFileSync(
			join(desktopRoot, "node_modules", "electron", "package.json"),
			"utf8",
		),
	).version
	const manifest = {
		schema: 1,
		version: FIXTURE_VERSION,
		platform: slug,
		arch,
		shellHash,
		electronVersion,
		installedYaml: "nsis",
		marker: {
			schema: 1,
			version: FIXTURE_VERSION,
			nodeVersion: installedMarker.nodeVersion,
			platform: slug,
			arch,
		},
		bundled: {
			node: installedMarker.nodeVersion,
			server: FIXTURE_VERSION,
			plugins: [],
		},
		layers,
	}
	writeFileSync(
		join(fixtureDir, `resources-pack-${slug}-${arch}.json`),
		`${JSON.stringify(manifest, null, "\t")}\n`,
		"utf8",
	)

	// The unpacked win-unpacked layout has no uninstaller, which the shell
	// reads as "portable" (updater off). A dummy uninstaller next to the
	// exe makes the real NSIS-install detection path run.
	if (process.platform === "win32") {
		writeFileSync(
			join(dirname(resolveExecutablePath()), "Uninstall Hoardodile.exe"),
			"",
		)
	}

	server = createServer((req, res) => {
		const name = req.url?.split("?")[0]?.replace(/^\/+/, "") ?? ""
		const file = join(fixtureDir, name)
		if (!existsSync(file) || !name.startsWith("resources-")) {
			res.writeHead(404)
			res.end()
			return
		}
		res.writeHead(200, { "content-type": "application/octet-stream" })
		res.end(readFileSync(file))
	})
	await new Promise<void>((resolveListen) => {
		server?.listen(0, "127.0.0.1", () => resolveListen())
	})
	const address = server.address()
	if (address === null || typeof address === "string") {
		throw new Error("fixture server did not bind")
	}
	baseUrl = `http://127.0.0.1:${address.port}/`
})

test.afterAll(() => {
	server?.close()
})

/** The bridge's current update state — the poll's failure output is readable. */
async function readUpdateState(appWin: Awaited<ReturnType<typeof appWindow>>) {
	const state = (await appWin.evaluate(() => {
		const bridge = (
			window as unknown as {
				hoardodileDesktop?: {
					updates: { status: () => Promise<unknown> }
				}
			}
		).hoardodileDesktop
		if (bridge === undefined) {
			throw new Error("desktop bridge missing")
		}
		return bridge.updates.status()
	})) as {
		status: string
		channel?: string
		version?: string
		message?: string
	}
	return {
		status: state.status,
		channel: state.channel ?? null,
		version: state.version ?? null,
		message: state.message ?? null,
	}
}

/** Drive wizard → claim → app shell; returns the app window. */
async function claimApp(harness: Awaited<ReturnType<typeof launchDesktop>>) {
	const wizard = await harness.app.firstWindow()
	await expect(wizard.locator("input#library-path")).not.toHaveValue("")
	await wizard.getByTestId("wizard-continue").click()
	await expect
		.poll(() =>
			harness.app.windows().some((win) => win.url().startsWith(harness.url)),
		)
		.toBe(true)
	const appWin = appWindow(harness.app, harness.url)
	await expect(appWin.getByTestId("setup-submit")).toBeVisible({
		timeout: 120_000,
	})
	const fields = appWin.locator('input[type="password"]')
	await fields.nth(0).fill(E2E_PASSWORD)
	await fields.nth(1).fill(E2E_PASSWORD)
	await appWin.getByTestId("setup-submit").click()
	await expectShellRendered(appWin)
	return appWin
}

test("a tampered layer reports an error and leaves the tree untouched", async () => {
	// Second fixture server: the same manifest with the server-dist layer
	// sha256 zeroed — the client must reject the download and touch nothing.
	// Declared BEFORE the happy-path test: the installed marker is still
	// the pristine one.
	const tamperedDir = mkdtempSync(join(tmpdir(), "hd-resource-tampered-"))
	const slug = feedSlug()
	const arch = process.arch
	const manifest = JSON.parse(
		readFileSync(
			join(fixtureDir, `resources-pack-${slug}-${arch}.json`),
			"utf8",
		),
	)
	const serverDist = manifest.layers.find(
		(layer: { name: string }) => layer.name === "server-dist",
	)
	serverDist.payload.sha256 = "0".repeat(64)
	writeFileSync(
		join(tamperedDir, `resources-pack-${slug}-${arch}.json`),
		JSON.stringify(manifest, null, "\t"),
	)
	for (const name of readdirSync(fixtureDir)) {
		if (name.startsWith("resources-layer-")) {
			writeFileSync(
				join(tamperedDir, name),
				readFileSync(join(fixtureDir, name)),
			)
		}
	}
	const tamperedServer = createServer((req, res) => {
		const name = req.url?.split("?")[0]?.replace(/^\/+/, "") ?? ""
		const file = join(tamperedDir, name)
		if (!existsSync(file) || !name.startsWith("resources-")) {
			res.writeHead(404)
			res.end()
			return
		}
		res.writeHead(200, { "content-type": "application/octet-stream" })
		res.end(readFileSync(file))
	})
	await new Promise<void>((resolveListen) => {
		tamperedServer.listen(0, "127.0.0.1", () => resolveListen())
	})
	const address = tamperedServer.address()
	if (address === null || typeof address === "string") {
		throw new Error("tampered fixture server did not bind")
	}
	const tamperedBase = `http://127.0.0.1:${address.port}/`

	const harness = await launchDesktop({ feedBase: tamperedBase })
	try {
		const appWin = await claimApp(harness)
		await expect
			.poll(() => readUpdateState(appWin), { timeout: 180_000 })
			.toMatchObject({ status: "error" })
		// In-app navigation (a full `goto` would hit the shell's
		// navigation policy — the user gets there via the sidebar; below
		// the breakpoint that means the drawer first).
		await navigateInShell(appWin, "Feedback & About")
		await expect(appWin.getByTestId("me-about-update-error")).toBeVisible({
			timeout: 15_000,
		})

		// The error path touched nothing: no swap traces, marker pristine.
		expect(existsSync(join(resourcesDir, ".swap-pending"))).toBe(false)
		expect(existsSync(join(resourcesDir, ".olds"))).toBe(false)
		expect(
			readdirSync(resourcesDir).some((name) => name.startsWith(".staging-")),
		).toBe(false)
		expect(
			JSON.parse(
				readFileSync(join(resourcesDir, "resources-version.json"), "utf8"),
			).version,
		).toBe(installedMarkerVersion)

		// The sidecar is still up on the persisted port.
		await expect
			.poll(
				() => {
					const config = JSON.parse(
						readFileSync(join(harness.userDataDir, "desktop.json"), "utf8"),
					)
					return fetch(`http://127.0.0.1:${config.port}/health`)
						.then((res) => res.ok)
						.catch(() => false)
				},
				{ timeout: 60_000 },
			)
			.toBe(true)
	} finally {
		await harness.close()
		tamperedServer.close()
	}
})

test("resource update applies in place against a fixture feed", async () => {
	const harness = await launchDesktop({ feedBase: baseUrl })
	try {
		// wizard → claim → app shell (same flow as the launch smoke).
		const appWin = await claimApp(harness)

		// The boot check (autoUpdate on, ~15 s after start) routes to the
		// resource channel: only the server-dist layer is downloaded. The
		// poll surfaces the exact state (incl. error message) on failure.
		await expect
			.poll(
				async () => {
					const state = (await appWin.evaluate(() => {
						const bridge = (
							window as unknown as {
								hoardodileDesktop?: {
									updates: { status: () => Promise<unknown> }
								}
							}
						).hoardodileDesktop
						if (bridge === undefined) {
							throw new Error("desktop bridge missing")
						}
						return bridge.updates.status()
					})) as {
						status: string
						channel?: string
						version?: string
						message?: string
					}
					return {
						status: state.status,
						channel: state.channel ?? null,
						version: state.version ?? null,
						message: state.message ?? null,
					}
				},
				{ timeout: 180_000 },
			)
			.toMatchObject({
				status: "ready",
				channel: "resources",
				version: FIXTURE_VERSION,
			})
		// The banner lives in the sidebar footer, which the shell hides below
		// the sidebar breakpoint (the GitHub Windows runner clamps the window
		// there) — reveal the sidebar content first, then narrow to the one
		// visible banner (it also renders in the hidden sidebar aside and,
		// once opened, in the drawer), or the assertion would hit a hidden
		// element or a strict-mode duplicate.
		await openShellContent(appWin)
		await expect(
			appWin.getByTestId("desktop-update-banner").filter({ visible: true }),
		).toBeVisible()

		// Apply: overlay phases, then swap + sidecar restart + reload.
		await appWin
			.getByTestId("desktop-update-restart")
			.filter({ visible: true })
			.click()
		await expect(appWin.getByTestId("desktop-update-applying")).toBeVisible({
			timeout: 60_000,
		})
		await expect(appWin.getByTestId("desktop-update-applying")).toBeHidden({
			timeout: 180_000,
		})

		// The window came back with the session intact (sidecar reborn on
		// the same port + library; cookie keyed by host+port survived).
		await expectShellRendered(appWin, { timeout: 120_000 })

		// The tree, the config and the library all agree on the version.
		await expect
			.poll(
				() =>
					JSON.parse(
						readFileSync(join(resourcesDir, "resources-version.json"), "utf8"),
					).version,
			)
			.toBe(FIXTURE_VERSION)
		await expect
			.poll(
				() =>
					JSON.parse(
						readFileSync(join(harness.userDataDir, "desktop.json"), "utf8"),
					).resourceVersion,
			)
			.toBe(FIXTURE_VERSION)

		// Health is live on the persisted port (a conflict fallback after
		// the sidecar restart may have shifted it); the library tree is
		// untouched.
		await expect
			.poll(
				() => {
					const config = JSON.parse(
						readFileSync(join(harness.userDataDir, "desktop.json"), "utf8"),
					)
					return fetch(`http://127.0.0.1:${config.port}/health`)
						.then((res) => res.ok)
						.catch(() => false)
				},
				{ timeout: 60_000 },
			)
			.toBe(true)
		expect(
			existsSync(join(harness.libraryDir, "hoardodile", "app.sqlite")),
		).toBe(true)
	} finally {
		await harness.close()
	}
})
