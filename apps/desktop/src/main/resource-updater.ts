import { createHash } from "node:crypto"
import {
	cpSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { join } from "node:path"
import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { net } from "electron"
import * as tar from "tar"
import {
	type ResourceSupport,
	resourcePackSlug,
	SWAP_ENTRIES,
	swapMarkerPath,
	swapStagingRoot,
} from "./resource-support.ts"
import {
	assertSwapSpace,
	beginSwap,
	commitSwap,
	deleteBackup,
	rollbackSwap,
} from "./resources-swap.ts"
import { contentHashTree, installedShellHash } from "./shell-hash.ts"
import {
	decideChannel,
	isResourcePackManifest,
	LAYER_SPECS,
	neededLayers,
	type ResourceLayer,
	type ResourcePackManifest,
} from "./update-plan.ts"

/**
 * The resource-pack channel: fetches the per-platform pack manifest from
 * the GitHub Release (stable-name direct links — no API, no token),
 * verifies every needed layer, stages the merged tree inside
 * `resources/`, and applies it by stopping the sidecar, swapping and
 * restarting. Every failure leaves the previous tree untouched or rolled
 * back; network trouble simply reports an error and waits for the next
 * check.
 *
 * `HOARDODILE_RESOURCE_FEED_BASE` (test-only, same style as
 * HOARDODILE_E2E) points the channel at a fixture feed — the e2e suite
 * uses it; shipped builds never set it.
 */
const FEED_BASE =
	process.env.HOARDODILE_RESOURCE_FEED_BASE ??
	"https://github.com/hoardodile/hoardodile/releases/latest/download"

/** Join a feed file name to the base without doubling slashes. */
export function feedUrl(fileName: string, base: string = FEED_BASE): string {
	return `${base.replace(/\/+$/, "")}/${fileName}`
}

/** How long a healthy new sidecar must stay up before the old tree is dropped. */
const SOAK_MS = 30_000

export type ResourceChannelDeps = {
	readonly enabled: boolean
	readonly dev: boolean
	readonly support: ResourceSupport
	readonly resourcesRoot: string
	readonly cacheDir: string
	readonly appVersion: string
	readonly electronVersion: string
	readonly platform: NodeJS.Platform
	readonly arch: string
	readonly getResourceVersion: () => string | null
	readonly setResourceVersion: (version: string) => void
	readonly stopSidecar: () => Promise<void>
	readonly startSidecar: () => Promise<void>
	/** Subscribe to sidecar crash events while an applied tree is soaking. */
	readonly watchSidecarCrash: (listener: () => void) => () => void
	readonly reloadWindow: () => Promise<void>
	readonly emit: (state: DesktopUpdateState) => void
	/** Test seam: the installed shell hash (defaults to the asar hash). */
	readonly localShellHash?: () => string | undefined
	/** Test seam: how long the applied tree soaks before the backup is dropped. */
	readonly soakMs?: number
}

export type ResourceChannelHandle = {
	/** `manual` bypasses the autoUpdate gate (the Settings check button). */
	readonly check: (manual?: boolean) => Promise<"full" | "none">
	readonly apply: () => Promise<void>
	readonly setEnabled: (enabled: boolean) => void
	readonly dispose: () => void
}

export function startResourceChannel(
	deps: ResourceChannelDeps,
): ResourceChannelHandle {
	let enabled = deps.enabled
	let readyVersion: string | undefined
	let stagingVersion: string | undefined
	let soakTimer: NodeJS.Timeout | undefined

	return {
		async check(manual = false) {
			if (deps.dev) return "none"
			if (!enabled && !manual) return "none"
			if (!deps.support.available) return "full"
			const slug = resourcePackSlug(deps.platform)
			if (slug === undefined) return "full"

			const fileStem = `resources-pack-${slug}-${deps.arch}`
			let manifest: ResourcePackManifest
			try {
				manifest = await fetchManifest(feedUrl(`${fileStem}.json`))
			} catch (err) {
				return reportFetchError(err, deps)
			}

			const local = {
				appVersion: deps.appVersion,
				resourceVersion: deps.getResourceVersion(),
				shellHash: (deps.localShellHash ?? installedShellHash)(),
				electronVersion: deps.electronVersion,
			}
			const plan = decideChannel(manifest, local, deps.support)
			if (plan === "none") {
				deps.emit({ status: "latest" })
				return "none"
			}
			if (plan === "full") return "full"

			// Resources: download the needed layers → verify → merge into
			// staging, then hand off to apply().
			const stagingRoot = swapStagingRoot(deps.resourcesRoot, manifest.version)
			try {
				await stageLayers(manifest, stagingRoot, deps)
			} catch (err) {
				return reportFetchError(err, deps)
			}
			stagingVersion = manifest.version
			readyVersion = manifest.version
			deps.emit({
				status: "ready",
				channel: "resources",
				version: manifest.version,
			})
			return "none"
		},

		async apply() {
			if (readyVersion === undefined || stagingVersion !== readyVersion) {
				throw new Error("resource update is not ready")
			}
			const version = readyVersion
			const stagingRoot = swapStagingRoot(deps.resourcesRoot, version)
			try {
				deps.emit({
					status: "applying",
					channel: "resources",
					phase: "stopping",
				})
				await deps.stopSidecar()

				// Space + swap; after the stop the tree is free to rename.
				assertSwapSpace({ resourcesRoot: deps.resourcesRoot, stagingRoot })
				deps.emit({
					status: "applying",
					channel: "resources",
					phase: "swapping",
				})
				beginSwap({ resourcesRoot: deps.resourcesRoot, stagingRoot, version })

				deps.emit({
					status: "applying",
					channel: "resources",
					phase: "starting",
				})
				try {
					await deps.startSidecar()
				} catch (err) {
					if (existsSync(swapMarkerPath(deps.resourcesRoot))) {
						rollbackSwap({ resourcesRoot: deps.resourcesRoot })
						try {
							await deps.startSidecar()
						} catch (restartError) {
							// The old tree is back but did not boot either —
							// this is now an ordinary crash state (tray Restart),
							// not a broken update.
							deps.emit({
								status: "error",
								message: String(
									restartError instanceof Error
										? restartError.message
										: restartError,
								),
							})
							return
						}
					}
					deps.emit({ status: "error", message: String(err) })
					return
				}

				// Healthy: commit, then soak; a crash inside the soak keeps the
				// old tree until the next boot cleanup (no rollback after
				// migration — the DB may already be on the new schema).
				commitSwap({ resourcesRoot: deps.resourcesRoot })
				deps.setResourceVersion(version)
				const unsubscribe = deps.watchSidecarCrash(() => {
					clearSoak()
				})
				soakTimer = setTimeout(() => {
					unsubscribe()
					deleteBackup({ resourcesRoot: deps.resourcesRoot })
					soakTimer = undefined
				}, deps.soakMs ?? SOAK_MS)
				await deps.reloadWindow()
				deps.emit({ status: "latest" })
			} finally {
				readyVersion = undefined
				stagingVersion = undefined
			}
		},

		setEnabled(next) {
			enabled = next
		},

		dispose() {
			clearSoak()
			if (stagingVersion !== undefined) {
				rmSync(swapStagingRoot(deps.resourcesRoot, stagingVersion), {
					recursive: true,
					force: true,
				})
			}
		},
	}

	function clearSoak(): void {
		if (soakTimer !== undefined) {
			clearTimeout(soakTimer)
			soakTimer = undefined
		}
	}
}

async function fetchManifest(url: string): Promise<ResourcePackManifest> {
	const res = await net.fetch(url, { cache: "no-store" })
	if (!res.ok) {
		const err: Error & { status?: number } = new Error(
			`resource manifest fetch failed (${res.status})`,
		)
		err.status = res.status
		throw err
	}
	const raw: unknown = await res.json()
	if (!isResourcePackManifest(raw)) {
		throw new Error("resource manifest is malformed")
	}
	return raw
}

/**
 * Merge the needed layers into the staging tree:
 * - layer identity matches the installed content → copy it in place
 *   (the swap unit is a top-level dir, so skipping means copying —
 *   never omitting, or the swap would silently lose node_modules);
 * - otherwise download → sha256/size verify → extract into staging.
 * The marker is written from the manifest, so the applied tree claims
 * exactly the release the client verified.
 */
async function stageLayers(
	manifest: ResourcePackManifest,
	stagingRoot: string,
	deps: ResourceChannelDeps,
): Promise<void> {
	// Any failure must leave no staging behind: a half-built `server/` in
	// the app dir is only safe to keep while the swap is committed.
	try {
		await stageLayersUnsafe(manifest, stagingRoot, deps)
	} catch (err) {
		rmSync(stagingRoot, { recursive: true, force: true })
		throw err
	}
}

async function stageLayersUnsafe(
	manifest: ResourcePackManifest,
	stagingRoot: string,
	deps: ResourceChannelDeps,
): Promise<void> {
	rmSync(stagingRoot, { recursive: true, force: true })
	mkdirSync(stagingRoot, { recursive: true })

	const installed: Record<string, string | undefined> = {}
	for (const layer of manifest.layers) {
		installed[layer.name] = installedLayerIdentity(layer, deps.resourcesRoot)
	}
	const { download, copy } = neededLayers(manifest, installed)

	const tmpDir = join(deps.cacheDir, ".resources-tmp")
	const totalBytes = download.reduce(
		(sum, layer) => sum + layer.payload.size,
		0,
	)
	let doneBytes = 0
	try {
		for (const layer of download) {
			await downloadLayer(layer, tmpDir, stagingRoot, (received) => {
				const present = doneBytes + received
				const percent = totalBytes > 0 ? (present / totalBytes) * 100 : 0
				deps.emit({
					status: "downloading",
					channel: "resources",
					percent: Math.min(percent, 100),
				})
			})
			doneBytes += layer.payload.size
		}
	} finally {
		rmSync(tmpDir, { recursive: true, force: true })
	}

	for (const layer of copy) {
		copyInstalledLayer(layer, deps.resourcesRoot, stagingRoot)
	}

	writeFileSync(
		join(stagingRoot, "resources-version.json"),
		`${JSON.stringify(manifest.marker, null, "\t")}\n`,
		"utf8",
	)

	// The staged tree must be complete before we ever stop the sidecar.
	for (const entry of SWAP_ENTRIES) {
		if (!existsSync(join(stagingRoot, entry))) {
			throw new Error(`resource pack is missing ${entry}`)
		}
	}
	if (!existsSync(join(stagingRoot, "server", "node_modules"))) {
		throw new Error("resource pack is missing server/node_modules")
	}
}

/** Identity of an installed layer; `undefined` (→ download) on any error. */
function installedLayerIdentity(
	layer: ResourceLayer,
	resourcesRoot: string,
): string | undefined {
	const spec = LAYER_SPECS[layer.name]
	if (spec === undefined) return undefined
	const root = join(resourcesRoot, ...spec.root)
	if (!existsSync(root)) return undefined
	try {
		return contentHashTree(root, { excludePrefixes: spec.exclude ?? [] })
	} catch {
		return undefined
	}
}

async function downloadLayer(
	layer: ResourceLayer,
	tmpDir: string,
	stagingRoot: string,
	report: (received: number) => void,
): Promise<void> {
	const tmpPath = join(tmpDir, layer.payload.fileName)
	const hash = createHash("sha256")
	const res = await net.fetch(feedUrl(layer.payload.fileName), {
		cache: "no-store",
	})
	if (!res.ok) {
		throw new Error(`${layer.name} download failed (${res.status})`)
	}
	mkdirSync(tmpDir, { recursive: true })
	await writeStream(res, tmpPath, hash, report)

	const digest = hash.digest("hex")
	if (digest !== layer.payload.sha256) {
		throw new Error(`${layer.name} checksum mismatch`)
	}
	if (statSync(tmpPath).size !== layer.payload.size) {
		throw new Error(`${layer.name} size mismatch`)
	}
	await tar.x({ file: tmpPath, cwd: stagingRoot })
	rmSync(tmpPath, { force: true })
}

/** Copy an unchanged installed layer into staging, merging child-by-child. */
function copyInstalledLayer(
	layer: ResourceLayer,
	resourcesRoot: string,
	stagingRoot: string,
): void {
	const spec = LAYER_SPECS[layer.name]
	if (spec === undefined) {
		throw new Error(`unknown layer ${layer.name}`)
	}
	const from = join(resourcesRoot, ...spec.root)
	const to = join(stagingRoot, ...spec.root)
	mkdirSync(to, { recursive: true })
	for (const child of readdirSync(from)) {
		cpSync(join(from, child), join(to, child), { recursive: true })
	}
}

async function writeStream(
	res: Response,
	dest: string,
	hash: ReturnType<typeof createHash>,
	onProgress: (received: number) => void,
): Promise<void> {
	const file = createWriteStream(dest)
	let received = 0
	try {
		if (res.body === null) throw new Error("empty response body")
		const reader = res.body.getReader()
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			if (value === undefined) break
			hash.update(value)
			file.write(value)
			received += value.byteLength
			onProgress(received)
		}
		await new Promise<void>((resolve, reject) => {
			file.end((err?: Error | null) => (err ? reject(err) : resolve()))
		})
	} finally {
		file.destroy()
	}
}

/**
 * One shared failure path: 404 means the newest published release has no
 * pack for this platform (a draft is invisible to `latest/download`), so
 * it is the same as "up to date"; anything else is a real error. Pure —
 * the caller emits.
 */
export function reportFetchErrorAction(
	err: unknown,
):
	| { readonly kind: "latest" }
	| { readonly kind: "error"; readonly message: string } {
	const status = (err as { status?: number }).status
	if (status === 404) {
		console.warn("[desktop] resource pack feed has no pack for this platform")
		return { kind: "latest" }
	}
	const message = err instanceof Error ? err.message : String(err)
	return { kind: "error", message }
}

function reportFetchError(err: unknown, deps: ResourceChannelDeps): "none" {
	const action = reportFetchErrorAction(err)
	if (action.kind === "latest") deps.emit({ status: "latest" })
	else deps.emit({ status: "error", message: action.message })
	return "none"
}
