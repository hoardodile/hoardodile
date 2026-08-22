import type { PluginSchema } from "@hoardodile/sdk-types"
import { PLUGIN_READ_FILE_MAX_BYTES } from "@hoardodile/sdk-types/plugin"
import { createPluginResourceAPI } from "./api.ts"
import { createDirectoryContainer } from "./directory-container.ts"
import type { ResourceAPI } from "./types.ts"

/**
 * Create a minimal {@link ResourceAPI} backed by a raw filesystem
 * directory. Used to run plugin hooks against a plain directory — during
 * import, before resources exist, or from the CLI. Built on the shared
 * {@link createPluginResourceAPI} so directory behavior matches the
 * archive-backed and fixture backends; probes are unsupported and resolve
 * to `undefined`.
 */
export function createDirectoryResourceAPI<
	TSchema extends PluginSchema = PluginSchema,
>(
	dir: string,
	opts: {
		readonly maxReadFileBytes?: number
		/**
		 * Writable directory for `extractArchive` materialization (the
		 * CLI passes a temp dir). Virtual-path reads (`outer!inner`) work
		 * without it; only the materializing hook needs it.
		 */
		readonly extractCacheDir?: string
		/**
		 * Session context handed to hooks as `api.context.detect` (see
		 * `CreatePluginResourceAPIDeps.detectContext`).
		 */
		readonly detectContext?: unknown
	} = {},
): ResourceAPI<TSchema> {
	return createPluginResourceAPI<TSchema>({
		view: createDirectoryContainer(dir),
		maxReadFileBytes: opts.maxReadFileBytes ?? PLUGIN_READ_FILE_MAX_BYTES,
		extractCacheDir: opts.extractCacheDir,
		detectContext: opts.detectContext,
	})
}

export { resolveSafeImportPath } from "./directory-container.ts"
