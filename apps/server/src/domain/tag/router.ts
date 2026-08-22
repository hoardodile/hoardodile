import {
	entityMetaCreateInput,
	entityMetaReorderInput,
	entityMetaUpdateInput,
	MAX_NAME_LENGTH,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { idInput, tagAttachmentInput } from "src/infra/trpc/inputs.ts"
import { flatEntityProcedures } from "src/infra/trpc/procedure-builders.ts"
import { z } from "zod"
import type { TagService } from "./service.ts"

const createInput = entityMetaCreateInput(MAX_NAME_LENGTH).extend({
	catId: z.string().min(1),
})

const updateInput = entityMetaUpdateInput(MAX_NAME_LENGTH).extend({
	catId: z.string().min(1).optional(),
})

const reorderInput = entityMetaReorderInput.extend({
	catId: z.string().min(1),
})

const attachInput = tagAttachmentInput

const mergeInput = z.object({
	sourceId: z.string().min(1),
	targetId: z.string().min(1),
})

const endpointKind = z.enum(["tag", "character"])

const siblingPairInput = z.object({
	badKind: endpointKind.default("tag"),
	badId: z.string().min(1),
	goodId: z.string().min(1),
})

const parentRuleInput = z.object({
	childKind: endpointKind.default("tag"),
	childId: z.string().min(1),
	parentId: z.string().min(1),
})

const siblingRuleRemoveInput = z.object({
	badKind: endpointKind.default("tag"),
	badId: z.string().min(1),
})

const bulkAttachInput = z.object({
	ids: z.array(z.string().min(1)).min(1).max(1000),
	tagId: z.string().min(1),
})

/**
 * tRPC sub-router for the tag module. Every procedure is auth-guarded.
 * Event dispatch is performed by the service layer.
 */
export function buildTagRouter(service: TagService) {
	return router({
		...flatEntityProcedures({
			listAll: () => service.listAll(),
			listAllWithCounts: () => service.listAllWithCounts(),
			detail: (id) => service.detail(id),
			delete: (id) => {
				service.delete(id)
			},
			forceDelete: (id, name) => {
				service.forceDelete(id, name)
			},
		}),
		create: writeProcedure
			.input(createInput)
			.mutation(({ input }) => service.create(input)),
		update: writeProcedure
			.input(updateInput)
			.mutation(({ input }) => service.update(input)),
		reorder: writeProcedure.input(reorderInput).mutation(({ input }) => {
			service.reorder(input.catId, input.ids)
		}),

		mergePreview: authedProcedure
			.input(mergeInput)
			.query(({ input }) =>
				service.mergePreview(input.sourceId, input.targetId),
			),
		merge: writeProcedure
			.input(mergeInput)
			.mutation(({ input }) => service.merge(input.sourceId, input.targetId)),

		siblingGroups: authedProcedure.query(() => service.siblingGroups()),
		siblingRuleCreate: writeProcedure
			.input(siblingPairInput)
			.mutation(({ input }) =>
				service.siblingRuleCreate({
					badKind: input.badKind,
					badId: input.badId,
					goodId: input.goodId,
				}),
			),
		siblingRuleRemove: writeProcedure
			.input(siblingRuleRemoveInput)
			.mutation(({ input }) =>
				service.siblingRuleRemove(input.badId, input.badKind),
			),
		siblingSetDisplay: writeProcedure
			.input(idInput)
			.mutation(({ input }) => service.siblingSetDisplay(input.id)),

		parentRules: authedProcedure.query(() => service.parentRules()),
		parentRuleCreate: writeProcedure
			.input(parentRuleInput)
			.mutation(({ input }) =>
				service.parentRuleCreate({
					childKind: input.childKind,
					childId: input.childId,
					parentId: input.parentId,
				}),
			),
		parentRuleRemove: writeProcedure
			.input(parentRuleInput)
			.mutation(({ input }) =>
				service.parentRuleRemove({
					childKind: input.childKind,
					childId: input.childId,
					parentId: input.parentId,
				}),
			),

		listForResource: authedProcedure
			.input(z.object({ resId: z.string().min(1) }))
			.query(({ input }) => service.listForResource(input.resId)),
		attachToResource: writeProcedure
			.input(attachInput)
			.mutation(({ input }) => {
				service.attachToResource(input.entityId, input.tagId)
			}),
		detachFromResource: writeProcedure
			.input(attachInput)
			.mutation(({ input }) => {
				service.detachFromResource(input.entityId, input.tagId)
			}),
		bulkAttachToResource: writeProcedure
			.input(bulkAttachInput)
			.mutation(({ input }) => {
				service.bulkAttachToResource(input.ids, input.tagId)
			}),
		bulkDetachFromResource: writeProcedure
			.input(bulkAttachInput)
			.mutation(({ input }) => {
				service.bulkDetachFromResource(input.ids, input.tagId)
			}),

		listForCharacter: authedProcedure
			.input(z.object({ charId: z.string().min(1) }))
			.query(({ input }) => service.listForCharacter(input.charId)),
		attachToCharacter: writeProcedure
			.input(attachInput)
			.mutation(({ input }) => {
				service.attachToCharacter(input.entityId, input.tagId)
			}),
		detachFromCharacter: writeProcedure
			.input(attachInput)
			.mutation(({ input }) => {
				service.detachFromCharacter(input.entityId, input.tagId)
			}),
		bulkAttachToCharacter: writeProcedure
			.input(bulkAttachInput)
			.mutation(({ input }) => {
				service.bulkAttachToCharacter(input.ids, input.tagId)
			}),
		bulkDetachFromCharacter: writeProcedure
			.input(bulkAttachInput)
			.mutation(({ input }) => {
				service.bulkDetachFromCharacter(input.ids, input.tagId)
			}),
	})
}

export type TagRouter = ReturnType<typeof buildTagRouter>
