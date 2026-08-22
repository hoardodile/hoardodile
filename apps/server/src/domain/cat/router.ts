import {
	catKind,
	entityMetaCreateInput,
	entityMetaReorderInput,
	entityMetaUpdateInput,
	MAX_NAME_LENGTH,
} from "@hoardodile/schemas"
import { router, writeProcedure } from "src/infra/trpc/core.ts"
import { flatEntityProcedures } from "src/infra/trpc/procedure-builders.ts"
import type { CatService } from "./service.ts"

const catKindEnum = catKind

const createInput = entityMetaCreateInput(MAX_NAME_LENGTH).extend({
	kind: catKindEnum,
})

const updateInput = entityMetaUpdateInput(MAX_NAME_LENGTH)

const reorderInput = entityMetaReorderInput.extend({
	kind: catKindEnum,
})

/**
 * tRPC sub-router for the category module. Every procedure is auth-guarded.
 * Categories are flat (no parent/child) and hard-deleted only.
 */
export function buildCategoryRouter(service: CatService) {
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
			service.reorder(input.kind, input.ids)
		}),
	})
}

export type CatRouter = ReturnType<typeof buildCategoryRouter>
