import {
	entityMetaCreateInput,
	entityMetaReorderInput,
	entityMetaUpdateInput,
	MAX_TRAIT_NAME_LENGTH,
	TRAIT_KINDS,
} from "@hoardodile/schemas"
import { router, writeProcedure } from "src/infra/trpc/core.ts"
import { flatEntityProcedures } from "src/infra/trpc/procedure-builders.ts"
import { z } from "zod"
import type { TraitService } from "./service.ts"

const createInput = entityMetaCreateInput(MAX_TRAIT_NAME_LENGTH, {
	positionNonNegative: true,
}).extend({
	kind: z.enum(TRAIT_KINDS),
})

const updateInput = entityMetaUpdateInput(MAX_TRAIT_NAME_LENGTH, {
	positionNonNegative: true,
})

const reorderInput = entityMetaReorderInput

/**
 * tRPC sub-router for the trait module. Every procedure is auth-guarded.
 * The `kind` of an existing trait is immutable; deleting and recreating is
 * the intended path for changing a trait's type. Event dispatch is handled
 * by the service layer.
 */
export function buildTraitRouter(service: TraitService) {
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
			service.reorder(input.ids)
		}),
	})
}

export type TraitRouter = ReturnType<typeof buildTraitRouter>
