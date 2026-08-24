import {
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
	MAX_SOURCE_NAME_LENGTH,
	MAX_URL_LENGTH,
	resolvedUsageTimeZone,
} from "@hoardodile/schemas"
import { pluginManifestId } from "@hoardodile/sdk-types/schema"
import { isDomainError } from "@hoardodile/shared"
import { TRPCError } from "@trpc/server"
import type { SessionStore } from "src/domain/auth/session.ts"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { idInput, resourceIdsInput } from "src/infra/trpc/inputs.ts"
import {
	pagedCardProcedures,
	pagedRowProcedures,
	softDeleteProcedures,
} from "src/infra/trpc/procedure-builders.ts"
import { z } from "zod"
import type { ResService } from "./service.ts"

export type ResourceRouterDeps = {
	readonly service: ResService
	readonly sessions: SessionStore
}

/**
 * Compound creation input. The client stages files via the per-file
 * upload endpoints, then calls this procedure. Two source kinds are
 * supported, mutually exclusive:
 *
 * - Ordered: stage each file via `POST /api/uploads/ordered` (returns a
 *   `fileId`), then pass the ordered `files: [fileId, …]` list here.
 * - Archive: stage a single zip via `POST /api/uploads/archive` (returns
 *   a `fileId`), then pass `archiveFileId` here.
 *
 * Direct creation of an empty resource is intentionally unsupported on
 * the public API - every resource owns its source folder.
 */
const createWithUploadInput = z.object({
	files: z.array(z.string().uuid()).optional(),
	names: z.array(z.string().min(1).max(700)).optional(),
	archiveFileId: z.string().uuid().optional(),
	filename: z.string().min(1).max(700).optional(),
	name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
	defaultNameTimeZone: resolvedUsageTimeZone,
	intro: z.string().max(MAX_INTRO_LENGTH).optional(),
	sourceName: z.string().max(MAX_SOURCE_NAME_LENGTH).optional(),
	sourceUrl: z.string().max(MAX_URL_LENGTH).optional(),
	contentPluginId: pluginManifestId.optional(),
	tagIds: z.array(z.string().min(1)).optional(),
	charIds: z.array(z.string().min(1)).optional(),
})

const updateInput = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
	intro: z.string().max(MAX_INTRO_LENGTH).optional(),
	sourceName: z.string().max(MAX_SOURCE_NAME_LENGTH).optional(),
	sourceUrl: z.string().max(MAX_URL_LENGTH).optional(),
	tagIds: z.array(z.string().min(1)).optional(),
	charIds: z.array(z.string().min(1)).optional(),
})

/**
 * tRPC sub-router that exposes the resource module. Every procedure is
 * auth-guarded and has automatic DomainError ->TRPCError translation
 * provided by {@link authedProcedure}. Event dispatch is performed by the
 * service layer.
 */
export function buildResourceRouter(deps: ResourceRouterDeps) {
	const { service, sessions } = deps
	return router({
		...pagedRowProcedures({
			list: (input) => service.list(input),
			trashList: (input) => service.trashList(input),
			detail: (id) => service.detail(id),
		}),
		...pagedCardProcedures({
			listCards: (input) => service.listCards(input),
			trashListCards: (input) => service.trashListCards(input),
			detailCard: (id) => service.detailCard(id),
		}),
		create: writeProcedure
			.input(createWithUploadInput)
			.mutation(({ input }) => service.create(input)),
		update: writeProcedure
			.input(updateInput)
			.mutation(({ input }) => service.update(input)),
		...softDeleteProcedures({
			softDelete: (id) => service.softDelete(id),
			restore: (id) => service.restore(id),
			hardDelete: (id) => service.hardDelete(id),
		}),
		softDeleteMany: writeProcedure
			.input(resourceIdsInput)
			.mutation(({ input }) => service.softDeleteMany(input.ids)),
		hardDeleteMany: writeProcedure
			.input(resourceIdsInput)
			.mutation(({ input }) => service.hardDeleteMany(input.ids)),
		setContentPluginId: writeProcedure
			.input(
				z.object({
					id: z.string().min(1),
					contentPluginId: pluginManifestId,
				}),
			)
			.mutation(({ input }) =>
				service.setContentPluginId(input.id, input.contentPluginId),
			),
		listFiles: authedProcedure.input(idInput).query(async ({ input }) => {
			try {
				return await service.listFiles(input.id)
			} catch (err) {
				if (isDomainError(err) && err.code === "NOT_FOUND") {
					const trashed = await service.listTrashedFiles(input.id)
					if (trashed !== undefined) return trashed
				}
				throw err
			}
		}),
		relatedByTags: authedProcedure
			.input(
				z.object({
					id: z.string().min(1),
					limit: z.number().int().min(1).max(20).default(5),
				}),
			)
			.query(({ input }) => service.relatedByTags(input.id, input.limit)),
		/**
		 * "On this day" cards for the overview. The client resolves its
		 * calendar day from the `timeZone` preference and sends it here
		 * (like the char `dateMonthDayOn` filter); `offsetMin` keeps the
		 * server's `strftime` interpretation in the same calendar day.
		 */
		memories: authedProcedure
			.input(
				z.object({
					month: z.number().int().min(1).max(12),
					day: z.number().int().min(1).max(31),
					offsetMin: z
						.number()
						.int()
						.min(-14 * 60)
						.max(14 * 60),
				}),
			)
			.query(({ input }) => service.memories(input)),
		/**
		 * Distinct user-set source names (most used first) for the list
		 * filter dropdown and form autocomplete.
		 */
		sourceNames: authedProcedure
			.input(
				z.object({
					limit: z.number().int().min(1).max(200).default(50),
				}),
			)
			.query(({ input }) => service.listSourceNames(input.limit)),
		similarImages: authedProcedure
			.input(idInput)
			.query(({ input }) => service.similarImages(input.id)),
		similarWithinResource: authedProcedure
			.input(idInput)
			.query(({ input }) => service.similarWithinResource(input.id)),
		duplicateImages: authedProcedure
			.input(idInput)
			.query(({ input }) => service.duplicateImages(input.id)),
		imageSearch: authedProcedure
			.input(z.object({ sessionId: z.string().uuid() }))
			.query(({ input }) => service.imageSearch(input.sessionId)),
		dislike: writeProcedure
			.input(z.object({ resourceId: z.string().min(1) }))
			.mutation(({ input }) => service.addDislike(input.resourceId)),
		listDislikes: authedProcedure
			.input(z.object({ resourceId: z.string().min(1) }))
			.query(({ input }) => service.listDislikes(input.resourceId)),
		pluginSessionToken: authedProcedure
			.input(z.object({ resId: z.string().min(1) }))
			.query(async ({ ctx, input }) => {
				const session = await sessions.read(
					ctx.req.cookies[ctx.env.SESSION_COOKIE_NAME],
				)
				if (session === undefined) {
					throw new TRPCError({ code: "UNAUTHORIZED" })
				}
				const token = await sessions.createToken(86400, {
					kind: "res",
					id: input.resId,
				})
				return token.sealed
			}),
	})
}

export type ResRouter = ReturnType<typeof buildResourceRouter>
