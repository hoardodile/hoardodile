import {
	entityMetaCreateInput,
	entityMetaReorderInput,
	entityMetaUpdateInput,
	MAX_NAME_LENGTH,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { flatEntityProcedures } from "src/infra/trpc/procedure-builders.ts"
import { z } from "zod"
import type { ResCollectionService } from "./service.ts"

const createInput = entityMetaCreateInput(MAX_NAME_LENGTH)

const updateInput = entityMetaUpdateInput(MAX_NAME_LENGTH)

const itemInput = z.object({
	colId: z.string().min(1),
	resId: z.string().min(1),
})

const reorderResourcesInput = z.object({
	colId: z.string().min(1),
	resIds: z.array(z.string().min(1)),
})

const reorderCollectionsInput = entityMetaReorderInput

/**
 * tRPC sub-router for the resource-collection module. Every procedure
 * is auth-guarded.
 */
export function buildResourceCollectionRouter(service: ResCollectionService) {
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

		listResourceIdsIn: authedProcedure
			.input(z.object({ colId: z.string().min(1) }))
			.query(({ input }) => service.listResourceIdsIn(input.colId)),
		listForResource: authedProcedure
			.input(z.object({ resId: z.string().min(1) }))
			.query(({ input }) => service.listForResource(input.resId)),
		attach: writeProcedure.input(itemInput).mutation(({ input }) => {
			service.attach(input.colId, input.resId)
		}),
		detach: writeProcedure.input(itemInput).mutation(({ input }) => {
			service.detach(input.colId, input.resId)
		}),
		reorder: writeProcedure
			.input(reorderCollectionsInput)
			.mutation(({ input }) => {
				service.reorder(input.ids)
			}),
		reorderResources: writeProcedure
			.input(reorderResourcesInput)
			.mutation(({ input }) => {
				service.reorderResources(input.colId, input.resIds)
			}),
	})
}

export type ResCollectionRouter = ReturnType<
	typeof buildResourceCollectionRouter
>
