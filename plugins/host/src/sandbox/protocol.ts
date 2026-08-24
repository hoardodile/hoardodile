/**
 * Wire protocol between the plugin sandbox host (server process) and the
 * sandbox child entry (`worker-entry.mjs`), which runs as a forked child
 * process with structured-clone IPC. The entry file is plain JS without
 * access to workspace TS sources, so it keeps its own copy of the
 * method/hook name lists — keep the two in sync (enforced by
 * `protocol.test.ts`).
 */

/**
 * Plugin hook names the host can invoke, in contract order — defined in
 * `@hoardodile/sdk-types`, re-exported so host internals keep one import
 * point.
 */
import { HOOK_NAMES, type HookName } from "@hoardodile/sdk-types"
import { PLUGIN_ASSET_ERROR_NAMES } from "@hoardodile/sdk-types/plugin-asset-limits"

export { HOOK_NAMES, type HookName }

/** ResourceAPI method names bridged over RPC. */
export const API_METHOD_NAMES = [
	"logInfo",
	"logWarn",
	"logError",
	"listFileNames",
	"readFile",
	"statFile",
	"statFiles",
	"sniff",
	"probe",
	"hashBytes",
	"computeImageHashes",
	"listContainer",
	"extractArchive",
	"download",
	"statAsset",
	"readAsset",
	"deleteAsset",
] as const

export type ApiMethodName = (typeof API_METHOD_NAMES)[number]

/** Fire-and-forget log methods — no response round-trip. */
export const LOG_METHOD_NAMES: ReadonlySet<ApiMethodName> = new Set([
	"logInfo",
	"logWarn",
	"logError",
])

export type SerializedError = {
	readonly name: string
	readonly message: string
	readonly stack?: string
	/**
	 * Machine-readable plugin error code (`DENIED`/`UNAVAILABLE`/`POLICY`)
	 * carried verbatim on the wire — the single field the host side reads
	 * to restore the plugin-facing `err.name`.
	 */
	readonly code?: string
}

// -- host → worker --

export type LoadRequest = {
	readonly type: "load"
	readonly mainPath: string
}

export type InvokeRequest = {
	readonly type: "invoke"
	readonly callId: number
	readonly hook: HookName
}

export type ApiResponse = {
	readonly type: "apiResult"
	readonly apiCallId: number
	readonly ok: boolean
	readonly value?: unknown
	readonly error?: SerializedError
}

// -- worker → host --

export type LoadResponse = {
	readonly type: "loaded"
	readonly ok: boolean
	readonly hooks?: readonly HookName[]
	readonly error?: SerializedError
}

export type InvokeResponse = {
	readonly type: "result"
	readonly callId: number
	readonly ok: boolean
	readonly value?: unknown
	readonly error?: SerializedError
}

export type ApiRequest = {
	readonly type: "api"
	readonly callId: number
	readonly apiCallId: number
	readonly method: ApiMethodName
	readonly args: readonly unknown[]
}

export type LogRequest = {
	readonly type: "log"
	readonly callId: number
	readonly method: "logInfo" | "logWarn" | "logError"
	readonly args: readonly unknown[]
}

export type WorkerMessage =
	| LoadResponse
	| InvokeResponse
	| ApiRequest
	| LogRequest

export function serializeError(err: unknown): SerializedError {
	if (err instanceof Error) {
		return {
			name: err.name,
			message: err.message,
			stack: err.stack,
			// The vocabulary errors carry their code in `name`; the wire
			// keeps an explicit `code` field so the receiving side never
			// re-parses or re-derives it.
			code: isAssetErrorName(err.name) ? err.name : undefined,
		}
	}
	return { name: "Error", message: String(err) }
}

export function deserializeError(err: SerializedError): Error {
	const e = new Error(err.message)
	// `code` is authoritative when present (the vocabulary survived);
	// `name` falls back for plain host errors.
	e.name = err.code ?? err.name
	if (err.stack !== undefined) e.stack = err.stack
	return e
}

function isAssetErrorName(name: string): boolean {
	return (PLUGIN_ASSET_ERROR_NAMES as readonly string[]).includes(name)
}
