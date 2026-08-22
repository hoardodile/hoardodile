import {
	type PlaceholderDataFunction,
	type QueryKey,
	queryOptions,
	type UseMutationOptions,
} from "@tanstack/react-query"
import { getTrpcClient, type RouterInputs, type RouterOutputs } from "./client"

/**
 * Generic, type-level builders that collapse the repetitive
 * `queryOptions({...})` / `UseMutationOptions<...>` boilerplate scattered
 * across `features/*\/queries.ts` and `features/*\/mutations.ts` into a
 * single typed call. Inputs and outputs are inferred from the server's
 * {@link RouterInputs} / {@link RouterOutputs} contract maps so call sites
 * never re-spell tRPC payload shapes.
 *
 * The runtime side traverses the (correctly-typed) tRPC client by
 * `[namespace][procedure]`, which is too dynamic for TypeScript to track
 * statically; one isolated structural cast is used inside {@link callQuery}
 * / {@link callMutation} to bridge that lookup. Every public surface is
 * fully typed.
 */

type Namespace = keyof RouterInputs

type ProcedureOf<N extends Namespace> = keyof RouterInputs[N] &
	keyof RouterOutputs[N] &
	string

/**
 * Mapped projection of the tRPC client surface keyed by namespace/procedure,
 * with each procedure's `query` / `mutate` carrying the exact input/output
 * types from the server contract. The runtime `getTrpcClient()` value is
 * structurally compatible (proxy-based dispatch) but the proxy type erases
 * indexed access, so we bridge it with a single isolated cast in
 * {@link dynamicClient}.
 */
type DynamicClient = {
	[N in Namespace]: {
		[P in ProcedureOf<N>]: {
			readonly query: (
				input: RouterInputs[N][P],
			) => Promise<RouterOutputs[N][P]>
			readonly mutate: (
				input: RouterInputs[N][P],
			) => Promise<RouterOutputs[N][P]>
		}
	}
}

// Bridge cast: tRPC's proxy client is structurally compatible with
// DynamicClient but its public type uses a private brand we cannot satisfy
// without internal symbols. This is the single point where the cast is
// concentrated; downstream callers are fully typed.
function dynamicClient(): DynamicClient {
	return getTrpcClient() as unknown as DynamicClient
}

/** Internal: dispatch `client[namespace][procedure].query(input)` with full I/O typing. */
function callQuery<N extends Namespace, P extends ProcedureOf<N>>(
	namespace: N,
	procedure: P,
	input: RouterInputs[N][P],
): Promise<RouterOutputs[N][P]> {
	return dynamicClient()[namespace][procedure].query(input)
}

/** Internal: dispatch `client[namespace][procedure].mutate(input)` with full I/O typing. */
function callMutation<N extends Namespace, P extends ProcedureOf<N>>(
	namespace: N,
	procedure: P,
	input: RouterInputs[N][P],
): Promise<RouterOutputs[N][P]> {
	return dynamicClient()[namespace][procedure].mutate(input)
}

/**
 * Build a `UseMutationOptions` whose `mutationFn` forwards the input to
 * `client[namespace][procedure].mutate(input)`.
 *
 * The optional `transform` lets callers expose a friendlier public input
 * (e.g. `readonly T[]`, partial shapes) while still satisfying the
 * server's wire type. Without it, the public input equals the wire input.
 *
 * @example
 *   export function softDeleteCharacter() {
 *     return trpcMutation("character", "softDelete")
 *   }
 *
 * @example
 *   export function createCharacter() {
 *     return trpcMutation("character", "create", {
 *       transform: (input: { name?: string; tagIds?: readonly string[] }) => ({
 *         ...input,
 *         tagIds: toMutableArray(input.tagIds),
 *       }),
 *     })
 *   }
 */
export function trpcMutation<N extends Namespace, P extends ProcedureOf<N>>(
	namespace: N,
	procedure: P,
): UseMutationOptions<RouterOutputs[N][P], Error, RouterInputs[N][P]>
export function trpcMutation<
	N extends Namespace,
	P extends ProcedureOf<N>,
	TInput,
>(
	namespace: N,
	procedure: P,
	options: { readonly transform: (input: TInput) => RouterInputs[N][P] },
): UseMutationOptions<RouterOutputs[N][P], Error, TInput>
export function trpcMutation<
	N extends Namespace,
	P extends ProcedureOf<N>,
	TInput,
>(
	namespace: N,
	procedure: P,
	options?: { readonly transform: (input: TInput) => RouterInputs[N][P] },
): UseMutationOptions<RouterOutputs[N][P], Error, TInput> {
	const transform = options?.transform
	return {
		mutationFn(input: TInput) {
			// When no transform is provided, the no-transform overload guarantees
			// `TInput = RouterInputs[N][P]`, but the unified implementation signature
			// keeps `TInput` generic, so a single bridge cast is needed here.
			const wireInput =
				transform === undefined
					? (input as unknown as RouterInputs[N][P])
					: transform(input)
			return callMutation(namespace, procedure, wireInput)
		},
	}
}

/**
 * Build a tRPC-backed `queryOptions()` value. Use when the queryFn is a
 * straight pass-through to a single procedure - features whose queryFn
 * branches across two procedures (e.g. `trash ? trashList : list`)
 * should call {@link trpcQuery} directly inside their own queryFn.
 *
 * @example
 *   export function tagListQueryOptions() {
 *     return trpcQueryOptions({
 *       namespace: "tag",
 *       procedure: "listAll",
 *       input: undefined,
 *       queryKey: tagKeys.all,
 *       staleTime: 2_000,
 *     })
 *   }
 */
export function trpcQueryOptions<
	N extends Namespace,
	P extends ProcedureOf<N>,
>(args: {
	readonly namespace: N
	readonly procedure: P
	readonly input: RouterInputs[N][P]
	readonly queryKey: QueryKey
	readonly staleTime?: number
	readonly gcTime?: number
	readonly enabled?: boolean
	readonly placeholderData?: PlaceholderDataFunction<RouterOutputs[N][P], Error>
}) {
	const {
		namespace,
		procedure,
		input,
		queryKey,
		staleTime,
		gcTime,
		enabled,
		placeholderData,
	} = args
	return queryOptions({
		queryKey,
		queryFn: () => callQuery(namespace, procedure, input),
		staleTime,
		gcTime,
		enabled,
		placeholderData,
	})
}

/**
 * Imperative `query()` invocation with full type inference. Useful inside
 * a `queryFn` that needs to branch over inputs or post-process results
 * before TanStack Query caches them.
 *
 * Procedures with no input (input type `void` / `undefined`) accept zero
 * input arguments; everything else is required.
 */
type QueryArgs<N extends Namespace, P extends ProcedureOf<N>> = [
	RouterInputs[N][P],
] extends [
	// biome-ignore lint/suspicious/noConfusingVoidType: tRPC infers `void` for input-less procedures so `void | undefined` is the correct distributional check.
	void | undefined,
]
	? readonly [] | readonly [input?: RouterInputs[N][P]]
	: readonly [input: RouterInputs[N][P]]

export function trpcQuery<N extends Namespace, P extends ProcedureOf<N>>(
	namespace: N,
	procedure: P,
	...rest: QueryArgs<N, P>
): Promise<RouterOutputs[N][P]> {
	const input = (rest[0] ?? undefined) as RouterInputs[N][P]
	return callQuery(namespace, procedure, input)
}

/** Imperative mutation invocation with full type inference. Use for direct mutation calls outside of React Query's `useMutation`. */
export function trpcMutate<N extends Namespace, P extends ProcedureOf<N>>(
	namespace: N,
	procedure: P,
	...rest: QueryArgs<N, P>
): Promise<RouterOutputs[N][P]> {
	const input = (rest[0] ?? undefined) as RouterInputs[N][P]
	return callMutation(namespace, procedure, input)
}

/**
 * Procedures of `N` whose input shape is structurally exactly `{ id: string }`.
 * Used to constrain {@link idMutation} so it can only be invoked on
 * procedures that match; richer inputs (e.g. `{ id; expectedVersion }` or
 * `{ ids: string[] }`) produce a type error at the call site, asking the
 * caller to use {@link trpcMutation} with an explicit `transform` instead.
 */
type IdInputProcedure<N extends Namespace> = {
	[P in ProcedureOf<N>]: RouterInputs[N][P] extends { id: string }
		? { id: string } extends RouterInputs[N][P]
			? P
			: never
		: never
}[ProcedureOf<N>]

/**
 * Convenience over {@link trpcMutation} for the common `(id: string) => ({ id })`
 * mutation shape (soft/hard delete, restore, etc.). The procedure must accept
 * exactly `{ id: string }` — see {@link IdInputProcedure}.
 *
 * @example
 *   export function softDeleteCharacterMutation() {
 *     return idMutation("character", "softDelete")
 *   }
 */
export function idMutation<N extends Namespace, P extends IdInputProcedure<N>>(
	namespace: N,
	procedure: P,
): UseMutationOptions<RouterOutputs[N][P], Error, string> {
	return {
		mutationFn(id: string) {
			return callMutation(namespace, procedure, {
				id,
			} satisfies { id: string } as RouterInputs[N][P])
		},
	}
}

// ── Payload helpers (merged from former payload.ts) ──────────────────────────

/**
 * Convert a `readonly T[] | undefined` into a fresh mutable `T[]`,
 * preserving `undefined`. Use at the boundary where a UI-side input
 * (often typed `readonly` for safety) feeds into tRPC `mutate()`.
 */
export function toMutableArray<T>(
	input: readonly T[] | undefined,
): T[] | undefined {
	if (input === undefined) return undefined
	return [...input]
}

/**
 * Convert a `Readonly<Record<string, V>> | undefined` into a fresh
 * mutable record, preserving `undefined`.
 */
export function toMutableRecord<V>(
	input: Readonly<Record<string, V>> | undefined,
): Record<string, V> | undefined {
	if (input === undefined) return undefined
	return { ...input }
}
