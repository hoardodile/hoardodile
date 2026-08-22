import { pluginManifestId } from "@hoardodile/sdk-types/schema"
import { TRPCError } from "@trpc/server"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { PluginService } from "./service.ts"

const updateInput = z.object({
	id: pluginManifestId,
	enabled: z.boolean().optional(),
	priority: z.number().int().optional(),
	pinned: z.boolean().optional(),
	color: z.string().optional(),
})

const reorderInput = z.object({
	ids: z.array(pluginManifestId),
})

const previewInitInput = z.object({
	pluginId: pluginManifestId,
	resId: z.string().min(1),
})

/** TTL of the file token handed to plugin iframes (24 h), matching `resource.pluginSessionToken`. */
const FILE_TOKEN_TTL_SECONDS = 86400

/**
 * Minimal structural views of the cross-domain services
 * {@link buildPluginRouter} needs for `previewInitContext`. Declared
 * locally so the plugin domain keeps its no-cross-domain-imports rule;
 * the concrete services wired in `infra/trpc/router.ts` satisfy these
 * shapes structurally.
 */
export type PluginRouterDeps = {
	readonly service: PluginService
	readonly prefs: {
		listByPlugin(
			pluginId: string,
		): readonly { readonly key: string; readonly value: string }[]
	}
	readonly cache: {
		listForRes(
			pluginId: string,
			resId: string,
		): readonly { readonly key: string; readonly value: string }[]
	}
	readonly sessions: {
		read(sealed: string | undefined): Promise<unknown>
		createToken(
			ttlSeconds: number,
			resId: string,
		): Promise<{ readonly sealed: string }>
	}
	/** Live resources bound to a content plugin (for uninstall confirmation). */
	readonly usage: {
		countByContentPluginId(pluginId: string): number
	}
	/** Cleans up a plugin's persisted prefs/cache after uninstall. */
	readonly cleanupPluginData?: (pluginId: string) => void
}

export function buildPluginRouter(deps: PluginRouterDeps) {
	const { service, prefs, cache, sessions, usage, cleanupPluginData } = deps
	return router({
		listAll: authedProcedure.query(() => service.listAll()),
		update: writeProcedure
			.input(updateInput)
			.mutation(({ input }) => service.update(input.id, input)),
		reorder: writeProcedure
			.input(reorderInput)
			.mutation(({ input }) => service.reorder(input.ids)),
		rescan: writeProcedure.mutation(() => service.rescan()),
		/**
		 * Number of live resources bound to a content plugin. Shown in the
		 * uninstall confirmation so the user knows what the plugin owns.
		 */
		usageCount: authedProcedure
			.input(z.object({ id: pluginManifestId }))
			.query(({ input }) => usage.countByContentPluginId(input.id)),
		/**
		 * Permanently uninstall a plugin (disk directory + settings row).
		 * Resources bound to it keep their `contentPluginId` and fall back
		 * to the builtin plugin on read paths until it is reinstalled.
		 */
		uninstall: writeProcedure
			.input(z.object({ id: pluginManifestId }))
			.mutation(async ({ input }) => {
				await service.uninstall(input.id)
				cleanupPluginData?.(input.id)
			}),
		/**
		 * Aggregated preview-bootstrap payload for a plugin iframe: the
		 * plugin's prefs, the resource-scoped cache, a fresh file token,
		 * and the client-asset fingerprint — everything the web host used
		 * to fetch through three separate calls. `prefs`/`cache` are
		 * collapsed to plain key→value records (empty values dropped),
		 * matching the shape the iframe context consumes directly.
		 */
		previewInitContext: authedProcedure
			.input(previewInitInput)
			.query(async ({ input, ctx }) => {
				// Same guard as `resource.pluginSessionToken`: a valid session
				// cookie must be present before a file token is issued.
				const session = await sessions.read(
					ctx.req.cookies[ctx.env.SESSION_COOKIE_NAME],
				)
				if (session === undefined) {
					throw new TRPCError({ code: "UNAUTHORIZED" })
				}
				const token = await sessions.createToken(
					FILE_TOKEN_TTL_SECONDS,
					input.resId,
				)
				return {
					prefs: toKeyValueRecord(prefs.listByPlugin(input.pluginId)),
					cache: toKeyValueRecord(
						cache.listForRes(input.pluginId, input.resId),
					),
					fileToken: token.sealed,
					assetVersion: service.getAssetVersion(input.pluginId),
				}
			}),
	})
}

export type PluginRouter = ReturnType<typeof buildPluginRouter>

/**
 * Collapse pref/cache entries to a key→value record, dropping empty
 * values — mirrors the filter the web client applied to the raw entry
 * lists before this endpoint existed.
 */
function toKeyValueRecord(
	entries: readonly { readonly key: string; readonly value: string }[],
): Record<string, string> {
	const record: Record<string, string> = {}
	for (const entry of entries) {
		if (entry.value === "") continue
		record[entry.key] = entry.value
	}
	return record
}
