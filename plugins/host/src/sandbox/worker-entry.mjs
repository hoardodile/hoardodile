/**
 * Plugin sandbox entry — the main script of the per-plugin child process.
 * Plain ESM JS on purpose: sandbox files do NOT get vite-node/vitest
 * transforms, so they must stay dependency-free (no workspace TS imports).
 * Keep HOOK_NAMES / API_METHOD_NAMES in sync with protocol.ts.
 *
 * The child runs under the Node permission model (no fs write, no child
 * processes, no native addons; fs reads limited to the plugin directory
 * and the sandbox entry itself) and this entry adds three layers before
 * the plugin bundle is ever imported:
 *
 *  1. Startup self-check — proves the permission model is actually active
 *     (the host probes the flag name, but a restricted process must also
 *     verify the restriction). Fail-closed: exit(1) when the model is off.
 *  2. Module policy gate — `registerHooks` (synchronous, main-thread, no
 *     worker grant needed) installs a resolve hook so every later import
 *     (`node:fs`, `node:http`, bare packages, ...) is denied; only
 *     `node:url`, files under the plugin dir and the entry itself may
 *     load. A follow-up self-check proves the gate is actually armed.
 *  3. Global scrub — `fetch`/`WebSocket`/`EventSource` throw and
 *     `process.env` is emptied, so ambient network/env capability never
 *     exists even without an import.
 *
 * The plugin's own data access goes through the RPC below (`process.send`
 * of `api` requests); the host executes every call in its own process.
 */
import { writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

if (process.send === undefined) {
	throw new Error(
		"worker-entry must run as a forked child process with an IPC channel",
	)
}

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
	"download",
	"statAsset",
	"readAsset",
	"deleteAsset",
]

const LOG_METHOD_NAMES = new Set(["logInfo", "logWarn", "logError"])

const pluginDir = process.argv[2]
if (typeof pluginDir !== "string" || pluginDir.length === 0) {
	process.stderr.write("[plugin-sandbox] missing plugin directory argument\n")
	process.exit(1)
}

// Optional third argument: the host-managed plugin vault directory
// (`<plugin-dir>/vault/` for disk plugins; for dev plugins it lives under
// the versioned storage instead of the dev directory). Passed so the
// module policy gate allows loading downloaded runtimes from the vault
// even when it sits outside the plugin directory.
const assetVaultDir = process.argv[3]

/** Absolute cap for one hook result crossing the IPC boundary. */
const MAX_RESULT_BYTES =
	Number(process.env.HOARDODILE_PLUGIN_MAX_RESULT_BYTES) || 256 * 1024 * 1024

/** Cap on `log*` messages per hook invocation (log spam resets the watchdog). */
const MAX_LOGS_PER_HOOK =
	Number(process.env.HOARDODILE_PLUGIN_MAX_LOGS_PER_HOOK) || 1000

/** Cap on ResourceAPI calls per hook invocation. */
const MAX_API_CALLS_PER_HOOK =
	Number(process.env.HOARDODILE_PLUGIN_MAX_API_CALLS_PER_HOOK) || 100000

// Per-invocation budgets: reset at the start of every hook so a burst in
// one hook never counts against the next (they fail the hook, like the
// result cap — a runaway log/RPC loop must not pin the host CPU).
let logCount = 0
let apiCallCount = 0

// -- layer 1: startup self-check (fail-closed) --

function permissionModelActive() {
	const probePath = join(
		tmpdir(),
		`hoardodile-sandbox-probe-${process.pid}-${Date.now()}`,
	)
	const api = process.permission
	if (api !== undefined && typeof api.has === "function") {
		try {
			// No fs-write grant exists at all, so a write must be denied.
			return api.has("fs.write", probePath) === false
		} catch {
			// Unsupported probe shape — fall through to the write probe.
		}
	}
	try {
		writeFileSync(probePath, "probe")
		return false
	} catch {
		return true
	}
}

if (!permissionModelActive()) {
	process.stderr.write(
		"[plugin-sandbox] startup self-check failed: the Node permission model is not active in this process — refusing to run untrusted plugin code. Check the Node version and that the sandbox flags reached the child.\n",
	)
	process.exit(1)
}

// -- layer 2: module policy gate (before any plugin code can import) --

if (typeof registerHooks !== "function") {
	process.stderr.write(
		"[plugin-sandbox] startup self-check failed: this Node build has no module.registerHooks — refusing to run plugin code unsandboxed.\n",
	)
	process.exit(1)
}

/** Case-insensitive comparison on Windows (drive letters, case folds). */
function normalizePath(value) {
	return process.platform === "win32" ? value.toLowerCase() : value
}

/** On-disk path → its canonical `file://` URL, in Node's own encoding. */
function toFileUrl(path) {
	// pathToFileURL is what the ESM loader uses for these paths, so the
	// gate prefixes MUST use its exact encoding — encodeURI leaves `~`
	// unescaped, which mismatched the loader's `%7E` (Temp dirs on
	// Windows runners are the short name, e.g. RUNNER~1) and made every
	// plugin under such a path look like it was outside the plugin dir.
	return pathToFileURL(path).href
}

const pluginDirPrefix = normalizePath(toFileUrl(pluginDir) + "/")
const assetVaultPrefix =
	typeof assetVaultDir === "string" && assetVaultDir.length > 0
		? normalizePath(toFileUrl(assetVaultDir) + "/")
		: undefined
const entryUrl = normalizePath(import.meta.url)

/**
 * The only modules a sandbox may load: `node:url` (bootstrap), files under
 * the plugin directory (the bundle is a single self-contained ESM file),
 * the host-managed plugin vault (downloaded runtimes — see the asset API
 * contract; read-only by the permission model, and the vault contents are
 * data the plugin itself requested under user consent), and the entry
 * itself. Everything else — every other `node:` builtin, bare package
 * names, `data:`/`blob:` URLs, absolute paths outside the plugin dir —
 * is denied. The Node permission model stays the second, OS-level layer
 * underneath.
 */
function isAllowedModule(url) {
	if (url === "node:url") return true
	if (!url.startsWith("file:")) return false
	const normalized = normalizePath(url)
	if (normalized === entryUrl) return true
	if (normalized.startsWith(pluginDirPrefix)) return true
	if (assetVaultPrefix !== undefined) {
		return normalized.startsWith(assetVaultPrefix)
	}
	return false
}

registerHooks({
	resolve(specifier, _context, nextResolve) {
		// Resolve first, then validate the FINAL destination — a relative
		// specifier like `../outside.js` only reveals its target after the
		// parent URL is folded in. Hooks must stay synchronous
		// (registerHooks does not support async hooks).
		const result = nextResolve(specifier, _context)
		if (isAllowedModule(result.url)) return result
		// Show the allowed prefixes so a canonicalization mismatch (URL
		// encoding, symlinked roots, casing) is diagnosable in one line.
		const allowed =
			assetVaultPrefix !== undefined
				? `${pluginDirPrefix}, ${assetVaultPrefix}`
				: pluginDirPrefix
		throw new Error(
			`[plugin-sandbox] module denied by policy: ${specifier} → ${result.url} (allowed: ${allowed})`,
		)
	},
})

// -- layer 2a: prove the policy gate is armed --
// A builtin the entry never imported (node:http): its import is not a
// permission-model operation, so a success means the plugin would run
// with full module access — only the gate above can deny it. (`node:fs`
// is already loaded by a top-level import, which would bypass the hook.)
try {
	await import("node:http")
	process.stderr.write(
		"[plugin-sandbox] startup self-check failed: module policy gate is not active in this process\n",
	)
	process.exit(1)
} catch {
	// Denied as expected — the gate is live.
}

// -- layer 3: global scrub --

function disabled(name) {
	return () => {
		throw new Error(
			`[plugin-sandbox] ${name} is disabled inside the plugin sandbox — use the ResourceAPI instead`,
		)
	}
}

for (const name of ["fetch", "WebSocket", "EventSource"]) {
	try {
		Object.defineProperty(globalThis, name, {
			value: disabled(name),
			writable: true,
			configurable: true,
		})
	} catch {
		// A non-configurable global stays; the module path to it is still denied.
	}
}

process.env = {}

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

function send(message) {
	try {
		process.send(message)
	} catch {
		// The channel closed (host gone or killed us) — nothing to deliver.
	}
}

/** Approximate serialized size of a value crossing to the host. */
function approxByteSize(value) {
	if (value instanceof Uint8Array) return value.byteLength
	try {
		return JSON.stringify(value).length * 2
	} catch {
		return Infinity
	}
}

function buildResourceApiProxy(callId) {
	const api = { context: { detect: detectPayload } }
	for (const name of API_METHOD_NAMES) {
		if (LOG_METHOD_NAMES.has(name)) {
			// Fire-and-forget: the contract types these as sync void, so the
			// proxy must not hand the plugin a promise to await. A thrown
			// budget error propagates into the plugin's hook — the hook
			// fails loudly instead of spamming forever.
			api[name] = (message, data) => {
				logCount += 1
				if (logCount > MAX_LOGS_PER_HOOK) {
					throw new Error(
						`[plugin-sandbox] log budget exceeded (${MAX_LOGS_PER_HOOK} per hook)`,
					)
				}
				send({
					type: "log",
					callId,
					method: name,
					args: [message, data],
				})
			}
			continue
		}
		api[name] = (...args) => {
			apiCallCount += 1
			if (apiCallCount > MAX_API_CALLS_PER_HOOK) {
				return Promise.reject(
					new Error(
						`[plugin-sandbox] API call budget exceeded (${MAX_API_CALLS_PER_HOOK} per hook) — batch with statFiles or reduce per-file fan-out`,
					),
				)
			}
			const apiCallId = nextApiCallId++
			return new Promise((resolve, reject) => {
				pendingApi.set(apiCallId, { resolve, reject })
				send({ type: "api", callId, apiCallId, method: name, args })
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
		send({ type: "loaded", ok: true, hooks })
	} catch (err) {
		send({ type: "loaded", ok: false, error: serializeError(err) })
	}
}

async function handleInvoke(callId, hook) {
	try {
		if (plugin === undefined) throw new Error("plugin not loaded")
		const fn = plugin[hook]
		if (typeof fn !== "function") throw new Error(`plugin has no hook ${hook}`)
		logCount = 0
		apiCallCount = 0
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
		if (approxByteSize(value) > MAX_RESULT_BYTES) {
			throw new Error(
				`[plugin-sandbox] hook result exceeds ${MAX_RESULT_BYTES} bytes — return a smaller payload or read large files by byte range`,
			)
		}
		send({ type: "result", callId, ok: true, value })
	} catch (err) {
		send({
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

process.on("message", (msg) => {
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

// The host is the process lifetime: when it goes away (crash, shutdown,
// tree-kill), the IPC channel closes and this child must not linger.
process.on("disconnect", () => {
	process.exit(0)
})
