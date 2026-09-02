import type { Server } from "node:http"
import type { ImageVariantQuery } from "@hoardodile/sdk-types/image-variant"

/**
 * A rebuild signal broadcast over the `/api/workbench/events` SSE stream
 * when the dev watch-build rewrites the plugin bundle. The page reloads
 * its plugin iframe in response.
 */
export type RebuildEvent = { readonly kind: "rebuild" }

/**
 * The SSE rebuild bus a caller can drive ahead of the workbench server
 * (`hoardodile plugin dev` passes one; `emit` is called after the hook
 * snapshots are invalidated and re-captured). A standalone server uses an
 * internal idle bus that never emits.
 */
export type RebuildBus = {
	readonly subscribe: (res: import("node:http").ServerResponse) => () => void
	readonly emit: (payload: RebuildEvent) => void
	readonly close: () => void
}

/**
 * Server-side hook results captured against the selected resource. The
 * workbench pushes these into the plugin iframe context so it renders
 * exactly like the app does. Produced by `hoardodile plugin dev`; the
 * workbench itself never runs a sandbox.
 */
export type WorkbenchHookSnapshot = {
	readonly pluginId: string
	readonly detect: {
		readonly ok: boolean
		readonly reasons?: readonly string[]
	}
	readonly sourceMeta: unknown
	readonly searchMeta: unknown
	readonly coverLocal: string | undefined
	readonly coverKind?: string
	readonly files: readonly unknown[] | undefined
	readonly fileStats: {
		readonly count?: number
		readonly sizeBytes?: number
	}
	readonly imageHashes?: readonly unknown[]
	readonly errors: Readonly<Record<string, string>>
	readonly capturedAt: number
}

/** A resource the workbench can open, as shown in the picker. */
export type WorkbenchResource = {
	readonly id: string
	readonly name: string
	/** Plugin that owns the resource in the source library, when known. */
	readonly contentPluginId?: string
	readonly fileVersion?: number
}

/**
 * The plugin-visible slice of a resource's stored state. Used to seed
 * the offline mock host so comments, danmaku, preferences and the
 * per-resource cache are the ones the plugin would really see. Writes
 * never leave the mock.
 */
export type WorkbenchResourceState = {
	readonly name?: string
	readonly messages?: readonly unknown[]
	readonly danmaku?: readonly unknown[]
	readonly prefs?: Readonly<Record<string, string>>
	readonly cache?: Readonly<Record<string, string>>
}

/** Bytes (or a cached path) plus the content type to serve them as. */
export type WorkbenchRendered = {
	readonly contentType: string
	readonly bytes?: Uint8Array
	readonly path?: string
}

/** Read-only file access for the selected resource. */
export type WorkbenchFileProvider = {
	readonly list: (
		resId: string,
	) => Promise<readonly string[]> | readonly string[]
	readonly stat: (
		resId: string,
		path: string,
	) =>
		| Promise<{ readonly sizeBytes: number } | undefined>
		| { readonly sizeBytes: number }
		| undefined
	readonly read: (
		resId: string,
		path: string,
	) => Promise<Uint8Array | undefined> | Uint8Array | undefined
}

/**
 * Everything the workbench page can ask for. Each is optional: without
 * a `preview` provider `?size=preview` (and the generic variant
 * parameters) falls back to the original bytes, without `frame` the
 * seek-preview route stays unmounted.
 */
export type WorkbenchProviders = {
	readonly resources: () =>
		| Promise<readonly WorkbenchResource[]>
		| readonly WorkbenchResource[]
	readonly files?: WorkbenchFileProvider
	readonly snapshot?: (
		resId: string,
	) =>
		| Promise<WorkbenchHookSnapshot | undefined>
		| WorkbenchHookSnapshot
		| undefined
	readonly state?: (
		resId: string,
	) =>
		| Promise<WorkbenchResourceState | undefined>
		| WorkbenchResourceState
		| undefined
	readonly preview?: (
		resId: string,
		path: string,
		/**
		 * The file route's raw variant query (`size`, `fmt`, `fit`,
		 * `area`, `q`) — parsed and validated by the provider, so the
		 * workbench mount itself stays dependency-free.
		 */
		variant?: ImageVariantQuery,
	) => Promise<WorkbenchRendered | undefined>
	readonly frame?: (
		resId: string,
		path: string,
		timeMs: number,
	) => Promise<WorkbenchRendered | undefined>
	readonly cover?: (resId: string) => Promise<WorkbenchRendered | undefined>
}

/** Options for {@link serveWorkbench}. */
export type ServeWorkbenchOptions = {
	/** Built plugin dist dir mounted at `/plugin` (manifest + index.html). */
	readonly pluginDir?: string
	/**
	 * Data root exposed as a single resource. Shorthand for the
	 * directory providers; ignored when `providers` is given.
	 */
	readonly dataDir?: string
	/**
	 * Root whose direct subfolders are individual resources (a folder of
	 * many test-data items), switchable in the workbench resource list.
	 * Shorthand for the resource-directory providers; ignored when
	 * `providers` is given.
	 */
	readonly resourceDir?: string
	/** Real data sources. `hoardodile plugin dev` supplies these. */
	readonly providers?: WorkbenchProviders
	/**
	 * Latest hook snapshot. Called per request so a watch-driven
	 * recapture is picked up without restarting. Merged into
	 * `providers` when both are given.
	 */
	readonly snapshot?: (
		resId: string,
	) =>
		| Promise<WorkbenchHookSnapshot | undefined>
		| WorkbenchHookSnapshot
		| undefined
	/**
	 * Preferred port to listen on. Defaults to 5199. If the port is in use
	 * the server rebinds to the next free port (bounded) and the printed
	 * URL reports the actual one; read `server.address()` for it.
	 */
	readonly port?: number
	/**
	 * Bind host. Defaults to 127.0.0.1.
	 */
	readonly host?: string
	/**
	 * Called once with the actual bound URL (`http://<host>:<port>`) once
	 * the server is listening. When provided it replaces the default
	 * `[workbench] serving on ...` log line — the caller owns the startup
	 * message, so it can print it only after e.g. the plugin build has
	 * settled, instead of being buried under the watcher's output.
	 */
	readonly onReady?: (url: string) => void
	/**
	 * The rebuild SSE bus mounted at `/api/workbench/events`. `hoardodile
	 * plugin dev` drives it from its dist watcher to auto-refresh the
	 * page; when omitted an internal idle bus serves the route (so the
	 * page still connects cleanly) but never emits.
	 */
	readonly rebuildBus?: RebuildBus
}

/**
 * Serve the published workbench SPA with the plugin bundle and the
 * resource data mounted read-only. Resolves once the server is
 * listening.
 */
export function serveWorkbench(opts: ServeWorkbenchOptions): Promise<Server>

/** Create an SSE rebuild bus to drive from a dist watcher (see {@link RebuildBus}). */
export function createRebuildBus(): RebuildBus

/** Providers over one plain directory, standing in for a single resource. */
export function createDirectoryProviders(
	dataDir: string,
	resId?: string,
): WorkbenchProviders

/**
 * Providers over a folder whose direct subfolders are individual
 * resources — each subfolder is one resource named by its basename, and
 * `files` reads are scoped to it.
 */
export function createResourceDirProviders(
	resourceRoot: string,
): WorkbenchProviders
