import {
	createMockDanmakuStore,
	createMockHost,
	createMockMessageStore,
	type MockFileBackend,
	type MockHost,
	type ReadFileRange,
} from "@hoardodile/host-web"
import type {
	Danmaku,
	FileStats,
	Message,
	SearchMeta,
} from "@hoardodile/sdk-types"
import type { PluginIframeContext } from "@hoardodile/sdk-web"

/**
 * Workbench page: mounts one plugin iframe against the offline mock
 * host, with real data served read-only by the dev server. No
 * hoardodile server is involved — `hoardodile plugin dev` owns the
 * sandbox, the storage reader and the render pipeline, and exposes them
 * over the routes this page calls.
 */

type WorkbenchManifest = {
	readonly id: string
	readonly name: string
}

type WorkbenchResource = {
	readonly id: string
	readonly name: string
	readonly contentPluginId?: string
}

/**
 * Server-side hook results captured against the selected resource.
 * Without them the iframe context would be empty and `listFiles` would
 * answer with generic rows — plugins that key off `sourceMeta` or their
 * own file shape would render nothing like they do in the app.
 */
type HookSnapshot = {
	readonly detect: {
		readonly ok: boolean
		readonly reasons?: readonly string[]
	}
	readonly sourceMeta: unknown
	readonly searchMeta: unknown
	readonly coverLocal?: string
	readonly files: readonly unknown[] | undefined
	readonly fileStats: FileStats
	readonly imageHashes?: readonly unknown[]
	readonly errors: Readonly<Record<string, string>>
}

/** The plugin-visible stored state used to seed the mock host. */
type ResourceState = {
	readonly name?: string
	readonly messages?: readonly Message[]
	readonly danmaku?: readonly Danmaku[]
	readonly prefs?: Readonly<Record<string, string>>
	readonly cache?: Readonly<Record<string, string>>
}

type ResourceContext = {
	readonly resId: string
	readonly snapshot: HookSnapshot | null
	readonly state: ResourceState | null
	readonly capabilities: {
		readonly preview: boolean
		readonly frame: boolean
	}
}

async function fetchJson<T>(path: string): Promise<T> {
	const res = await fetch(path, { cache: "no-store" })
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`)
	return res.json()
}

/**
 * Read the context for one resource. A dev server without the route
 * (or without a captured snapshot yet) still mounts the page, so a
 * client-only plugin can be worked on offline.
 */
async function fetchContext(resId: string): Promise<ResourceContext> {
	try {
		return await fetchJson<ResourceContext>(
			`/api/workbench/context?res=${encodeURIComponent(resId)}`,
		)
	} catch {
		return {
			resId,
			snapshot: null,
			state: null,
			capabilities: { preview: false, frame: false },
		}
	}
}

/**
 * File backend over the dev server's read-only `/data` mount, scoped to
 * the selected resource. The plugin's own `listFiles` rows come from the
 * hook snapshot, matching what the production host answers with.
 */
function createHttpFileBackend(
	resId: string,
	readSnapshot: () => HookSnapshot | null,
): MockFileBackend {
	const scope = `res=${encodeURIComponent(resId)}`
	return {
		async listFiles() {
			return fetchJson<readonly string[]>(`/data/?list=1&${scope}`)
		},
		async listFileEntries() {
			return readSnapshot()?.files
		},
		async readFile(_resId, path, range) {
			const res = await fetch(`/data/${encodeURIComponent(path)}?${scope}`)
			if (!res.ok) throw new Error(`HTTP ${res.status} reading ${path}`)
			return sliceArrayBuffer(await res.arrayBuffer(), range)
		},
		async statFile(_resId, path) {
			const size = await fetchJson<number | null>(
				`/data/?stat=${encodeURIComponent(path)}&${scope}`,
			)
			return size === null ? undefined : { sizeBytes: size }
		},
	}
}

/** Apply a half-open byte range (start inclusive, end exclusive), clamped. */
function sliceArrayBuffer(
	buf: ArrayBuffer,
	range?: ReadFileRange,
): ArrayBuffer {
	if (range === undefined) return buf
	const bytes = new Uint8Array(buf)
	const start = Math.max(0, range.start ?? 0)
	const end = Math.min(range.end ?? bytes.length, bytes.length)
	return bytes.slice(start, end).buffer
}

function buildContext(
	pluginId: string,
	resource: WorkbenchResource,
	ctx: ResourceContext,
): PluginIframeContext {
	const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches
	return {
		pluginId,
		resId: resource.id,
		resName: ctx.state?.name ?? resource.name,
		sourceMeta: ctx.snapshot?.sourceMeta,
		searchMeta: ctx.snapshot?.searchMeta as SearchMeta | undefined,
		fileStats: ctx.snapshot?.fileStats,
		contentPluginId: resource.contentPluginId ?? pluginId,
		language: "en",
		resolvedTheme: dark ? "dark" : "light",
		palette: "parchment",
		iconStyle: "duotone",
		fonts: { family: "", cssPaths: [] },
		initialPrefs: ctx.state?.prefs ?? {},
		initialCache: ctx.state?.cache ?? {},
		fileToken: "",
	}
}

/** Short status line describing what the dev server reported. */
function describeContext(ctx: ResourceContext): string {
	const snapshot = ctx.snapshot
	if (snapshot === null) return "no hook snapshot"
	const parts = [
		snapshot.detect.ok
			? "detect ok"
			: `detect miss (${(snapshot.detect.reasons ?? []).join(", ")})`,
	]
	if (snapshot.files !== undefined) {
		parts.push(`${snapshot.files.length} files`)
	} else if (snapshot.fileStats.count !== undefined) {
		parts.push(`${snapshot.fileStats.count} files`)
	}
	if (snapshot.sourceMeta !== undefined) parts.push("sourceMeta")
	if (snapshot.searchMeta !== undefined) parts.push("searchMeta")
	if (snapshot.coverLocal !== undefined) {
		parts.push(`cover ${snapshot.coverLocal}`)
	}
	if (snapshot.imageHashes !== undefined) {
		parts.push(`${snapshot.imageHashes.length} hashes`)
	}
	if (!ctx.capabilities.preview) parts.push("no preview render")
	if (!ctx.capabilities.frame) parts.push("no frame render")
	for (const hook of Object.keys(snapshot.errors)) parts.push(`${hook} failed`)
	return parts.join(" · ")
}

function setText(selector: string, text: string): void {
	const el = document.querySelector(selector)
	if (el !== null) el.textContent = text
}

/** One mounted iframe plus the host bound to it. */
type Mounted = {
	readonly host: MockHost
	readonly win: Window | null
	readonly dispose: () => void
}

function mountIframe(opts: {
	readonly manifest: WorkbenchManifest
	readonly resource: WorkbenchResource
	readonly ctx: ResourceContext
}): Mounted {
	const { manifest, resource, ctx } = opts
	const host = createMockHost({
		targetWindow: window,
		files: createHttpFileBackend(resource.id, () => ctx.snapshot),
		messages: createMockMessageStore(ctx.state?.messages ?? []),
		danmaku: createMockDanmakuStore(ctx.state?.danmaku ?? []),
		prefs: ctx.state?.prefs,
		cache: ctx.state?.cache,
	})

	const stage = document.querySelector("#stage")
	stage?.replaceChildren()
	const frame = document.createElement("iframe")
	frame.src = "/plugin/index.html"
	frame.sandbox.add("allow-scripts", "allow-forms", "allow-downloads")
	frame.referrerPolicy = "no-referrer"
	stage?.appendChild(frame)

	const state: { win: Window | null } = { win: null }
	frame.addEventListener("load", () => {
		const win = frame.contentWindow
		if (win === null) return
		state.win = win
		host.register(win, { pluginId: manifest.id, resId: resource.id })
		host.pushContext(win, buildContext(manifest.id, resource, ctx))
		host.setVisibility(win, true)
	})

	return {
		host,
		get win() {
			return state.win
		},
		dispose() {
			if (state.win !== null) host.unregister(state.win)
			host.dispose()
			frame.remove()
		},
	}
}

export async function mountWorkbench(): Promise<void> {
	const manifest = await fetchJson<WorkbenchManifest>("/plugin/manifest.json")
	setText("#plugin-name", `${manifest.name} (${manifest.id})`)

	const resources = await fetchJson<readonly WorkbenchResource[]>(
		"/api/workbench/resources",
	).catch(() => [])
	const picker = document.querySelector<HTMLSelectElement>("#resource-picker")
	if (picker !== null) {
		picker.replaceChildren(
			...resources.map((resource) => {
				const option = document.createElement("option")
				option.value = resource.id
				option.textContent = resource.name
				return option
			}),
		)
		picker.hidden = resources.length < 2
	}

	if (resources.length === 0) {
		setText(
			"#hook-status",
			"no resources — pass --data <dir> or --storage <hoardodile-root>",
		)
		return
	}

	let current: Mounted | undefined
	const cover = document.querySelector<HTMLImageElement>("#resource-cover")

	/**
	 * Point the picker's cover thumbnail at the resource's rendered
	 * cover. The route mirrors the app's `GET /api/resources/:id/cover`;
	 * a 404 (no cover source, or the render pipeline is unavailable)
	 * hides the thumbnail via the image's error handler.
	 */
	function refreshCover(resId: string): void {
		if (cover === null) return
		cover.onerror = () => {
			cover.hidden = true
			cover.removeAttribute("src")
		}
		cover.src = `/api/resources/${encodeURIComponent(resId)}/cover`
		cover.hidden = false
	}

	// Switching resources is a full remount, exactly like the app's
	// preview dialog: every piece of per-resource state resets.
	async function open(resource: WorkbenchResource): Promise<void> {
		current?.dispose()
		const ctx = await fetchContext(resource.id)
		setText("#hook-status", describeContext(ctx))
		current = mountIframe({ manifest, resource, ctx })
		refreshCover(resource.id)
	}

	function selected(): WorkbenchResource {
		const id = picker?.value
		return resources.find((r) => r.id === id) ?? resources[0]!
	}

	picker?.addEventListener("change", () => {
		void open(selected())
	})
	// A reload picks up both the rebuilt bundle and the hooks recaptured
	// against it, so what the iframe renders always matches one build.
	document.querySelector("#reload")?.addEventListener("click", () => {
		void open(selected())
	})
	await open(selected())
}
