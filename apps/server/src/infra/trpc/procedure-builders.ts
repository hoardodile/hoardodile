import type { ListPageInput } from "@hoardodile/shared"
import { authedProcedure, writeProcedure } from "src/infra/trpc/core.ts"
import {
	forceDeleteInput,
	idInput,
	listByIdsInput,
	listInput,
} from "src/infra/trpc/inputs.ts"

/**
 * Procedure builders that capture recurring tRPC patterns. Each builder
 * returns a **plain object literal** of procedures so the consuming
 * `router({ ... })` call preserves concrete input/output inference per
 * procedure - we deliberately avoid generic router factories here.
 *
 * Compose the returned objects via spread:
 *
 * @example
 *   return router({
 *     ...softDeleteProcedures({ ... }),
 *     create: ...,
 *     update: ...,
 *   })
 */

/**
 * The standard `softDelete` / `restore` / `hardDelete` triple that every
 * soft-delete-aware module exposes. Each handler receives the entity
 * `id` and delegates to its service.
 *
 * Each handler's return type is captured as a generic and surfaces as
 * the procedure's output type, so tRPC inference stays sharp on the
 * client side.
 */
export function softDeleteProcedures<TSoft, TRestore, THard>(handlers: {
	readonly softDelete: (id: string) => TSoft | Promise<TSoft>
	readonly restore: (id: string) => TRestore | Promise<TRestore>
	readonly hardDelete: (id: string) => THard | Promise<THard>
}) {
	return {
		softDelete: writeProcedure
			.input(idInput)
			.mutation(({ input }) => handlers.softDelete(input.id)),
		restore: writeProcedure
			.input(idInput)
			.mutation(({ input }) => handlers.restore(input.id)),
		hardDelete: writeProcedure
			.input(idInput)
			.mutation(({ input }) => handlers.hardDelete(input.id)),
	}
}

/**
 * The shared "flat entity" surface (tag / category / trait): two list
 * queries, a detail query, a soft-ish `delete`, and a `forceDelete`
 * confirmation mutation. Per-module `create` / `update` procedures are
 * added by the caller because their inputs differ per entity.
 */
export function flatEntityProcedures<TList, TListCounts, TDetail>(handlers: {
	readonly listAll: () => TList | Promise<TList>
	readonly listAllWithCounts: () => TListCounts | Promise<TListCounts>
	readonly detail: (id: string) => TDetail | Promise<TDetail>
	readonly delete: (id: string) => void
	readonly forceDelete: (id: string, name: string) => void
}) {
	return {
		listAll: authedProcedure.query(() => handlers.listAll()),
		listAllWithCounts: authedProcedure.query(() =>
			handlers.listAllWithCounts(),
		),
		detail: authedProcedure
			.input(idInput)
			.query(({ input }) => handlers.detail(input.id)),
		delete: writeProcedure
			.input(idInput)
			.mutation(({ input }) => handlers.delete(input.id)),
		forceDelete: writeProcedure
			.input(forceDeleteInput)
			.mutation(({ input }) => handlers.forceDelete(input.id, input.name)),
	}
}

/**
 * The standard paged "row" surface every soft-delete-aware aggregate
 * exposes: a list query, a trash list query, and an `id` lookup. Input
 * schemas are the shared {@link listInput} / {@link idInput}; outputs
 * are captured per-handler as generics so client-side tRPC inference
 * stays sharp per procedure.
 *
 * Card-shape projections live in {@link pagedCardProcedures}; aggregates
 * that expose both spread the two builders together.
 */
export function pagedRowProcedures<TList, TTrash, TDetail>(handlers: {
	readonly list: (input: ListPageInput) => TList | Promise<TList>
	readonly trashList: (input: ListPageInput) => TTrash | Promise<TTrash>
	readonly detail: (id: string) => TDetail | Promise<TDetail>
}) {
	return {
		list: authedProcedure
			.input(listInput)
			.query(({ input }) => handlers.list(input)),
		trashList: authedProcedure
			.input(listInput)
			.query(({ input }) => handlers.trashList(input)),
		detail: authedProcedure
			.input(idInput)
			.query(({ input }) => handlers.detail(input.id)),
	}
}

/**
 * Card-shape sibling of {@link pagedRowProcedures}: the listCards /
 * trashListCards / detailCard triple. Only aggregates with a card
 * projection (resource, character) use this; spread alongside
 * {@link pagedRowProcedures}.
 *
 * The byIds variants serve the bulk "only selected" view. They are
 * mutations so a large id set rides in the POST body instead of the URL
 * (GET queries hit Node's 16 KB header cap at a few hundred ids); both
 * delegate to the same handlers as their plain counterparts.
 */
export function pagedCardProcedures<TList, TTrash, TDetail>(handlers: {
	readonly listCards: (input: ListPageInput) => TList | Promise<TList>
	readonly trashListCards: (input: ListPageInput) => TTrash | Promise<TTrash>
	readonly detailCard: (id: string) => TDetail | Promise<TDetail>
}) {
	return {
		listCards: authedProcedure
			.input(listInput)
			.query(({ input }) => handlers.listCards(input)),
		trashListCards: authedProcedure
			.input(listInput)
			.query(({ input }) => handlers.trashListCards(input)),
		listCardsByIds: authedProcedure
			.input(listByIdsInput)
			.mutation(({ input }) => handlers.listCards(input)),
		trashListCardsByIds: authedProcedure
			.input(listByIdsInput)
			.mutation(({ input }) => handlers.trashListCards(input)),
		detailCard: authedProcedure
			.input(idInput)
			.query(({ input }) => handlers.detailCard(input.id)),
	}
}
