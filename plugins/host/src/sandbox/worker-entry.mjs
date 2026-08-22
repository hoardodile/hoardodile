/**
 * Plugin sandbox worker entry. Plain ESM JS on purpose: worker threads do NOT
 * get vite-node/vitest transforms, so this file must stay dependency-free
 * (no workspace TS imports). Keep HOOK_NAMES / API_METHOD_NAMES in sync with
 * protocol.ts.
 */
import { pathToFileURL } from "node:url"
import { parentPort } from "node:worker_threads"

const HOOK_NAMES = [
	"detect",
	"sourceMeta",
	"searchMeta",
	"coverLocal",
	"listFiles",
	"imageHashes",
]

const API_METHOD_NAMES = [
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
]

const LOG_METHOD_NAMES = new Set(["logInfo", "logWarn", "logError"])

if (parentPort === null) {
	throw new Error("worker-entry must run inside a worker thread")
}
const port = parentPort

/** @type {Record<string, unknown> | undefined} */
let plugin

/**
 * Payload of the last successful `detect` invocation (the result
 * without the `ok` marker), exposed to later hooks as
 * `api.context.detect`. Reset on load and on a failed detection.
 * @type {Record<string, unknown> | undefined}
 */
let detectPayload

let nextApiCallId = 1
/** @type {Map<number, { resolve: (value: unknown) => void, reject: (err: Error) => void }>} */
const pendingApi = new Map()

function serializeError(err) {
	if (err instanceof Error) {
		return { name: err.name, message: err.message, stack: err.stack }
	}
	return { name: "Error", message: String(err) }
}

function deserializeError(err) {
	const e = new Error(err.message)
	e.name = err.name
	if (err.stack !== undefined) e.stack = err.stack
	return e
}

function transferListOf(value) {
	if (
		value instanceof Uint8Array &&
		value.byteOffset === 0 &&
		value.byteLength === value.buffer.byteLength &&
		value.buffer instanceof ArrayBuffer
	) {
		return [value.buffer]
	}
	return []
}

function buildResourceApiProxy(callId) {
	const api = { context: { detect: detectPayload } }
	for (const name of API_METHOD_NAMES) {
		if (LOG_METHOD_NAMES.has(name)) {
			// Fire-and-forget: the contract types these as sync void, so the
			// proxy must not hand the plugin a promise to await.
			api[name] = (message, data) => {
				port.postMessage({
					type: "log",
					callId,
					method: name,
					args: [message, data],
				})
			}
			continue
		}
		api[name] = (...args) => {
			const apiCallId = nextApiCallId++
			return new Promise((resolve, reject) => {
				pendingApi.set(apiCallId, { resolve, reject })
				// Never transfer here: transfer would neuter the plugin's own
				// buffer (e.g. setCover data the plugin reuses after the call).
				port.postMessage({ type: "api", callId, apiCallId, method: name, args })
			})
		}
	}
	return api
}

async function handleLoad(mainPath) {
	try {
		const mod = await import(pathToFileURL(mainPath).href)
		const def =
			mod !== null && typeof mod === "object" ? mod.default : undefined
		if (
			def === null ||
			typeof def !== "object" ||
			typeof def.detect !== "function"
		) {
			throw new Error(
				"plugin main.js must default-export a definition with detect()",
			)
		}
		const hooks = HOOK_NAMES.filter((h) => typeof def[h] === "function")
		plugin = def
		detectPayload = undefined
		port.postMessage({ type: "loaded", ok: true, hooks })
	} catch (err) {
		port.postMessage({ type: "loaded", ok: false, error: serializeError(err) })
	}
}

async function handleInvoke(callId, hook) {
	try {
		if (plugin === undefined) throw new Error("plugin not loaded")
		const fn = plugin[hook]
		if (typeof fn !== "function") throw new Error(`plugin has no hook ${hook}`)
		const value = await fn(buildResourceApiProxy(callId))
		// Keep the payload of a successful detect for the next hooks —
		// the one-pass classification every other hook can build on. A
		// failed or payload-less detection leaves the context absent.
		if (hook === "detect" && isRecord(value) && value.ok === true) {
			const { ok: _ok, ...payload } = value
			detectPayload = Object.keys(payload).length > 0 ? payload : undefined
		} else if (hook === "detect") {
			detectPayload = undefined
		}
		port.postMessage(
			{ type: "result", callId, ok: true, value },
			transferListOf(value),
		)
	} catch (err) {
		port.postMessage({
			type: "result",
			callId,
			ok: false,
			error: serializeError(err),
		})
	}
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

port.on("message", (msg) => {
	if (msg === null || typeof msg !== "object") return
	switch (msg.type) {
		case "load":
			void handleLoad(msg.mainPath)
			return
		case "invoke":
			void handleInvoke(msg.callId, msg.hook)
			return
		case "apiResult": {
			const pending = pendingApi.get(msg.apiCallId)
			if (pending === undefined) return
			pendingApi.delete(msg.apiCallId)
			if (msg.ok) {
				pending.resolve(msg.value)
			} else {
				pending.reject(deserializeError(msg.error))
			}
			return
		}
	}
})
