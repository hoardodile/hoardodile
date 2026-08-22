import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type {
	AsyncPrefService,
	CacheService,
	PluginPrefService,
	SystemPrefService,
} from "./service.ts"

const KEY_MAX_LENGTH = 256
const VALUE_MAX_LENGTH = 1024 * 1024

const keySchema = z.string().min(1).max(KEY_MAX_LENGTH)

const setInput = z.object({
	key: keySchema,
	value: z.string().max(VALUE_MAX_LENGTH),
})

/**
 * tRPC sub-router for system preferences.
 */
export function buildSystemPreferenceRouter(service: SystemPrefService) {
	return router({
		get: authedProcedure
			.input(z.object({ key: keySchema }))
			.query(({ input }) => service.get(input.key)),
		getMany: authedProcedure
			.input(z.object({ keys: z.array(keySchema).max(64) }))
			.query(({ input }) => service.getMany(input.keys)),
		listAll: authedProcedure.query(() => service.listAll()),
		set: writeProcedure
			.input(setInput)
			.mutation(({ input }) => service.set(input.key, input.value)),
		remove: writeProcedure
			.input(z.object({ key: keySchema }))
			.mutation(({ input }) => {
				service.remove(input.key)
			}),
		removeAll: writeProcedure.mutation(() => {
			service.removeAll()
		}),
	})
}

export type SystemPrefRouter = ReturnType<typeof buildSystemPreferenceRouter>

/**
 * tRPC sub-router for async preferences.
 *
 * Async prefs are fetched on demand by the client and are never mirrored in
 * the synchronous prefSync store. They share the same value shape as system
 * prefs but live under a separate namespace so the two pipelines cannot
 * collide.
 */
export function buildAsyncPreferenceRouter(service: AsyncPrefService) {
	return router({
		get: authedProcedure
			.input(z.object({ key: keySchema }))
			.query(({ input }) => service.get(input.key)),
		getMany: authedProcedure
			.input(z.object({ keys: z.array(keySchema).max(64) }))
			.query(({ input }) => service.getMany(input.keys)),
		set: writeProcedure
			.input(setInput)
			.mutation(({ input }) => service.set(input.key, input.value)),
		remove: writeProcedure
			.input(z.object({ key: keySchema }))
			.mutation(({ input }) => {
				service.remove(input.key)
			}),
	})
}

export type AsyncPrefRouter = ReturnType<typeof buildAsyncPreferenceRouter>

/**
 * tRPC sub-router for plugin preferences and cache.
 */
export function buildPluginPreferenceRouter(
	service: PluginPrefService,
	cacheService: CacheService,
) {
	return router({
		get: authedProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					key: keySchema,
				}),
			)
			.query(({ input }) => service.get(input.pluginId, input.key)),
		getMany: authedProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					keys: z.array(keySchema).max(64),
				}),
			)
			.query(({ input }) => service.getMany(input.pluginId, input.keys)),
		listByPlugin: authedProcedure
			.input(z.object({ pluginId: z.string().min(1) }))
			.query(({ input }) => service.listByPlugin(input.pluginId)),
		set: writeProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					key: keySchema,
					value: z.string().max(VALUE_MAX_LENGTH),
				}),
			)
			.mutation(({ input }) =>
				service.set(input.pluginId, input.key, input.value),
			),
		remove: writeProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					key: keySchema,
				}),
			)
			.mutation(({ input }) => service.remove(input.pluginId, input.key)),
		removeAllByPlugin: writeProcedure
			.input(z.object({ pluginId: z.string().min(1) }))
			.mutation(({ input }) => service.removeAllByPlugin(input.pluginId)),
		removeAll: writeProcedure.mutation(() => {
			service.removeAll()
		}),

		// Layer-3 cache endpoints
		cacheGet: authedProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					resId: z.string().min(1),
					key: z.string().min(1).max(KEY_MAX_LENGTH),
				}),
			)
			.query(({ input }) =>
				cacheService.get(input.pluginId, input.resId, input.key),
			),
		cacheList: authedProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					resId: z.string().min(1),
				}),
			)
			.query(({ input }) =>
				cacheService.listForRes(input.pluginId, input.resId),
			),
		cacheSet: writeProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					resId: z.string().min(1),
					key: z.string().min(1).max(KEY_MAX_LENGTH),
					value: z.string().max(VALUE_MAX_LENGTH),
				}),
			)
			.mutation(({ input }) =>
				cacheService.set(input.pluginId, input.resId, input.key, input.value),
			),
		cacheRemove: writeProcedure
			.input(
				z.object({
					pluginId: z.string().min(1),
					resId: z.string().min(1),
					key: z.string().min(1).max(KEY_MAX_LENGTH),
				}),
			)
			.mutation(({ input }) =>
				cacheService.remove(input.pluginId, input.resId, input.key),
			),
		cacheRemoveAllByPlugin: writeProcedure
			.input(z.object({ pluginId: z.string().min(1) }))
			.mutation(({ input }) => cacheService.removeAllByPlugin(input.pluginId)),
		cacheRemoveAll: writeProcedure.mutation(() => {
			cacheService.removeAll()
		}),
		cacheListByResId: authedProcedure
			.input(z.object({ resId: z.string().min(1) }))
			.query(({ input }) => cacheService.listByResId(input.resId)),
	})
}

export type PluginPrefRouter = ReturnType<typeof buildPluginPreferenceRouter>
