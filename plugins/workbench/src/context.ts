import type { MockFileBackend, ReadFileRange } from "@hoardodile/host-web"
import type {
	Danmaku,
	FileStats,
	Message,
	SearchMeta,
} from "@hoardodile/sdk-types"
import type { PluginIframeContext } from "@hoardodile/sdk-web"

/**
 * Workbench page data: the dev-server APIs plus the pure assembly of the
 * plugin iframe context. No hoardodile server is involved —
 * `hoardodile plugin dev` owns the sandbox, the storage reader and the
 * render pipeline, and exposes them over the routes this module calls.
 */

export type WorkbenchManifest = {
	readonly id: string
	readonly name: string
	/**
	 * Manifest capabilities that gate mock behavior. The dev server
	 * serves the plugin's real manifest; absence means the workbench
	 * treats the permission as not granted (matching app semantics).
	 */
	readonly permissions?: {
		readonly download?: boolean
	}
}

export type WorkbenchResource = {
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
export type HookSnapshot = {
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
export type ResourceState = {
	readonly name?: string
	readonly messages?: readonly Message[]
	readonly danmaku?: readonly Danmaku[]
	readonly prefs?: Readonly<Record<string, string>>
	readonly cache?: Readonly<Record<string, string>>
}

export type ResourceContext = {
	readonly resId: string
	readonly snapshot: HookSnapshot | null
	readonly state: ResourceState | null
	readonly capabilities: {
		readonly preview: boolean
		readonly frame: boolean
	}
}

export async function fetchJson<T>(path: string): Promise<T> {
	const res = await fetch(path, { cache: "no-store" })
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`)
	return res.json()
}

/**
 * Read the context for one resource. A dev server without the route
 * (or without a captured snapshot yet) still mounts the page, so a
 * client-only plugin can be worked on offline.
 */
export async function fetchContext(resId: string): Promise<ResourceContext> {
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
export function createHttpFileBackend(
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

/** The resolved configuration the iframe sees — assembled once per config change. */
export type IframePresentation = {
	readonly resolvedTheme: PluginIframeContext["resolvedTheme"]
	readonly palette: PluginIframeContext["palette"]
	readonly iconStyle: PluginIframeContext["iconStyle"]
	readonly language: string
	readonly fonts: PluginIframeContext["fonts"]
}

export function buildContext(
	pluginId: string,
	resource: WorkbenchResource,
	ctx: ResourceContext,
	presentation: IframePresentation,
): PluginIframeContext {
	return {
		pluginId,
		resId: resource.id,
		resName: ctx.state?.name ?? resource.name,
		sourceMeta: ctx.snapshot?.sourceMeta,
		searchMeta: ctx.snapshot?.searchMeta as SearchMeta | undefined,
		fileStats: ctx.snapshot?.fileStats,
		contentPluginId: resource.contentPluginId ?? pluginId,
		language: presentation.language,
		resolvedTheme: presentation.resolvedTheme,
		palette: presentation.palette,
		iconStyle: presentation.iconStyle,
		fonts: presentation.fonts,
		initialPrefs: ctx.state?.prefs ?? {},
		initialCache: ctx.state?.cache ?? {},
		fileToken: "",
		// Dev-only placeholder: the workbench's `/api/plugin-assets/…`
		// route accepts any token (the app issues HMAC-scoped ones; the
		// workbench vault is local scratch).
		assetToken: "workbench",
	}
}

/**
 * One diagnostic row for the info popover's Hooks section. Each kind is a
 * distinct fact; the renderer maps a kind to a label/value pair (plus a
 * tooltip for the error message), so heterogeneous results are no longer
 * flattened into identical chips.
 */
export type HookDiagnosticRow =
	| {
			readonly kind: "detect"
			readonly ok: boolean
			readonly reasons?: readonly string[]
	  }
	| { readonly kind: "files"; readonly count: number }
	| { readonly kind: "cover"; readonly file: string }
	| { readonly kind: "hashes"; readonly count: number }
	| { readonly kind: "meta"; readonly hook: "sourceMeta" | "searchMeta" }
	| { readonly kind: "error"; readonly hook: string; readonly message: string }

/**
 * Structured hook-verdict rows for the info popover: detection first,
 * then the plugin hooks that yielded data, then the failed hooks last so
 * they are not missed. Meta hooks are reported as *provided* only when a
 * value was captured — the snapshot cannot distinguish an unimplemented
 * hook from one that returned empty, so absence is simply omitted. Render
 * capabilities belong to the Capabilities section and are deliberately
 * not repeated here (DESIGN.md — metadata is quiet).
 */
export function describeHookDiagnostics(
	ctx: ResourceContext,
): readonly HookDiagnosticRow[] {
	const snapshot = ctx.snapshot
	if (snapshot === null) return []
	const rows: HookDiagnosticRow[] = [
		{
			kind: "detect",
			ok: snapshot.detect.ok,
			reasons: snapshot.detect.reasons,
		},
	]
	if (snapshot.files !== undefined) {
		rows.push({ kind: "files", count: snapshot.files.length })
	} else if (snapshot.fileStats.count !== undefined) {
		rows.push({ kind: "files", count: snapshot.fileStats.count })
	}
	if (snapshot.coverLocal !== undefined) {
		rows.push({ kind: "cover", file: snapshot.coverLocal })
	}
	if (snapshot.imageHashes !== undefined) {
		rows.push({ kind: "hashes", count: snapshot.imageHashes.length })
	}
	if (snapshot.sourceMeta !== undefined)
		rows.push({ kind: "meta", hook: "sourceMeta" })
	if (snapshot.searchMeta !== undefined)
		rows.push({ kind: "meta", hook: "searchMeta" })
	for (const [hook, message] of Object.entries(snapshot.errors)) {
		rows.push({ kind: "error", hook, message })
	}
	return rows
}

/** Short status line describing what the dev server reported. */
export function describeContext(ctx: ResourceContext): string {
	if (ctx.snapshot === null) return "no hook snapshot"
	return describeHookDiagnostics(ctx).map(describeRow).join(" · ")
}

function describeRow(row: HookDiagnosticRow): string {
	switch (row.kind) {
		case "detect":
			return row.ok
				? "detect ok"
				: `detect miss (${(row.reasons ?? []).join(", ")})`
		case "files":
			return `${row.count} files`
		case "cover":
			return `cover ${row.file}`
		case "hashes":
			return `${row.count} hashes`
		case "meta":
			return row.hook
		case "error":
			return `${row.hook} failed: ${row.message}`
	}
}
