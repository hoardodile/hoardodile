import { pathToFileURL } from "node:url"
import { createDirectoryResourceAPI } from "./directory-api.ts"
import type { HookName } from "./sandbox/protocol.ts"

/**
 * Plugin hooks the dev runner can invoke against a directory — the
 * contract-order list shared with the sandbox host and the CLI.
 */
export type PluginHookName = HookName

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

/**
 * Load a built plugin `main.js` and invoke one hook with a
 * directory-backed {@link ResourceAPI}. Development aid only — the plugin
 * runs unsandboxed in the current process, so only run code you trust.
 * Consumed from plugin tests as a devDependency; never bundled into a
 * shipped plugin.
 *
 * Before the target hook runs, `detect` is invoked once (when the
 * target is not detect itself) so hooks see the session context a real
 * sandbox session would have — `api.context.detect` carries the
 * detection payload. A throwing or missed detection leaves the context
 * absent, exactly like a fresh worker in production.
 */
export async function runPluginHook(opts: {
	readonly mainPath: string
	readonly hook: PluginHookName
	readonly dir: string
	/** Scratch dir for `extractArchive` materialization. */
	readonly extractCacheDir?: string
}): Promise<{ readonly result: unknown; readonly durationMs: number }> {
	const mod: unknown = await import(pathToFileURL(opts.mainPath).href)
	if (!isRecord(mod) || !isRecord(mod.default)) {
		throw new Error(
			`Plugin at ${opts.mainPath} must default-export a plugin definition`,
		)
	}
	const hook = mod.default[opts.hook]
	if (typeof hook !== "function") {
		throw new Error(
			`Plugin at ${opts.mainPath} has no "${opts.hook}" hook (expected a function on the default export)`,
		)
	}

	let detectContext: unknown
	if (opts.hook !== "detect" && typeof mod.default.detect === "function") {
		try {
			const detected = await mod.default.detect(
				createDirectoryResourceAPI(opts.dir, {
					extractCacheDir: opts.extractCacheDir,
				}),
			)
			if (isRecord(detected) && detected.ok === true) {
				const { ok: _ok, ...payload } = detected
				if (Object.keys(payload).length > 0) detectContext = payload
			}
		} catch {
			// A throwing detector leaves the context absent — same as a
			// fresh worker in production.
		}
	}

	const api = createDirectoryResourceAPI(opts.dir, {
		extractCacheDir: opts.extractCacheDir,
		detectContext,
	})
	const started = performance.now()
	const result: unknown = await hook(api)
	return { result, durationMs: performance.now() - started }
}
