import {
	charactershipsForCharactersInput,
	charByIdsInput,
	entityMetaCreateInput,
	entityMetaReorderInput,
	entityMetaUpdateInput,
	hierarchyFrom,
	MAX_CHARACTER_INTRO_LENGTH,
	MAX_NAME_LENGTH,
	MAX_RELATIONSHIP_LABEL_LENGTH,
	MAX_RELATIONSHIP_TYPE_NAME_LENGTH,
	relationshipKind,
	resolvedUsageTimeZone,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import {
	forceDeleteInput,
	idInput,
	resourceIdsInput,
} from "src/infra/trpc/inputs.ts"
import {
	pagedCardProcedures,
	pagedRowProcedures,
	softDeleteProcedures,
} from "src/infra/trpc/procedure-builders.ts"
import { z } from "zod"
import type { RelationshipService } from "./relationship_service.ts"
import type { CharService } from "./service.ts"

const createInput = z.object({
	name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
	defaultNameTimeZone: resolvedUsageTimeZone,
	intro: z.string().max(MAX_CHARACTER_INTRO_LENGTH).optional(),
	tagIds: z.array(z.string().min(1)).optional(),
	traitValues: z.record(z.string(), z.string().min(1)).optional(),
})

const updateInput = z.object({
	id: z.string().min(1),
	name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
	intro: z.string().max(MAX_CHARACTER_INTRO_LENGTH).optional(),
	tagIds: z.array(z.string().min(1)).optional(),
	traitValues: z.record(z.string(), z.string().min(1)).optional(),
})

const createTypeInput = entityMetaCreateInput(
	MAX_RELATIONSHIP_TYPE_NAME_LENGTH,
	{ allowPosition: false },
).extend({
	selfLabel: z.string().max(MAX_RELATIONSHIP_LABEL_LENGTH).optional(),
	targetLabel: z.string().max(MAX_RELATIONSHIP_LABEL_LENGTH).optional(),
	kind: relationshipKind.optional(),
	hierarchyFrom: hierarchyFrom.nullable().optional(),
})

const updateTypeInput = entityMetaUpdateInput(
	MAX_RELATIONSHIP_TYPE_NAME_LENGTH,
	{ allowPosition: false },
).extend({
	selfLabel: z.string().max(MAX_RELATIONSHIP_LABEL_LENGTH).optional(),
	targetLabel: z.string().max(MAX_RELATIONSHIP_LABEL_LENGTH).optional(),
	kind: relationshipKind.optional(),
	hierarchyFrom: hierarchyFrom.nullable().optional(),
})

const reorderRelationshipTypesInput = entityMetaReorderInput

const createCharactershipInput = z
	.object({
		typeId: z.string().min(1),
		selfId: z.string().min(1).optional(),
		targetId: z.string().min(1).optional(),
		externalName: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
		notes: z.string().max(MAX_CHARACTER_INTRO_LENGTH).optional(),
		metadata: z
			.object({
				order: z.number().int().optional(),
				note: z.string().optional(),
			})
			.optional(),
	})
	.refine(
		(value) => {
			const hasExternal = value.externalName !== undefined
			const hasSelf = value.selfId !== undefined
			const hasTarget = value.targetId !== undefined
			if (hasExternal) {
				return (hasSelf && !hasTarget) || (!hasSelf && hasTarget)
			}
			return hasSelf && hasTarget
		},
		{
			message: "provide both selfId and targetId, or one id with externalName",
		},
	)
	.refine(
		(value) =>
			value.selfId === undefined ||
			value.targetId === undefined ||
			value.selfId !== value.targetId,
		{ message: "charactership self-loop is not allowed" },
	)

const updateCharactershipInput = z.object({
	id: z.string().min(1),
	notes: z.string().max(MAX_CHARACTER_INTRO_LENGTH).optional(),
	metadata: z
		.object({
			order: z.number().int().optional(),
			note: z.string().optional(),
		})
		.optional(),
})

const listCharactershipsInput = z.object({ charId: z.string().min(1) })

export function buildCharacterRouter({
	service,
	relationships,
}: {
	readonly service: CharService
	readonly relationships: RelationshipService
}) {
	return router({
		// ── Character CRUD ───────────────────────────────────────────────────
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
		// Mutation so a large id set rides in the POST body instead of the URL
		// (GET queries hit Node's 16 KB header cap at a few hundred ids).
		byIds: authedProcedure
			.input(charByIdsInput)
			.mutation(({ input }) => service.byIds(input.ids)),
		create: writeProcedure
			.input(createInput)
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

		// ── Relationship types ───────────────────────────────────────────────
		listRelationshipTypes: authedProcedure.query(() =>
			relationships.listTypes(),
		),
		listRelationshipTypesWithCounts: authedProcedure.query(() =>
			relationships.listTypesWithCounts(),
		),
		createRelationshipType: writeProcedure
			.input(createTypeInput)
			.mutation(({ input }) => relationships.createType(input)),
		updateRelationshipType: writeProcedure
			.input(updateTypeInput)
			.mutation(({ input }) => relationships.updateType(input)),
		deleteRelationshipType: writeProcedure
			.input(idInput)
			.mutation(({ input }) => {
				relationships.deleteType(input.id)
			}),
		forceDeleteRelationshipType: writeProcedure
			.input(forceDeleteInput)
			.mutation(({ input }) => {
				relationships.forceDeleteType(input.id, input.name)
			}),
		reorderRelationshipTypes: writeProcedure
			.input(reorderRelationshipTypesInput)
			.mutation(({ input }) => relationships.reorderTypes(input.ids)),

		// ── Characterships ───────────────────────────────────────────────────
		listCharacterships: authedProcedure
			.input(listCharactershipsInput)
			.query(({ input }) => relationships.listCharacterships(input.charId)),
		listCharactershipsForCharacters: authedProcedure
			.input(charactershipsForCharactersInput)
			.mutation(({ input }) =>
				relationships.listCharactershipsForCharacters(input.charIds),
			),
		createCharactership: writeProcedure
			.input(createCharactershipInput)
			.mutation(({ input }) => relationships.createCharactership(input)),
		updateCharactership: writeProcedure
			.input(updateCharactershipInput)
			.mutation(({ input }) => relationships.updateCharactership(input)),
		deleteCharactership: writeProcedure.input(idInput).mutation(({ input }) => {
			relationships.deleteCharactership(input.id)
		}),
	})
}

export type CharRouter = ReturnType<typeof buildCharacterRouter>
