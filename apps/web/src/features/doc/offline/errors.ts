import { isTRPCClientError } from "@trpc/client"

/**
 * A request failed at the transport level, as opposed to a server-side
 * business error. tRPC surfaces transport failures as `TRPCClientError`
 * instances without a server payload, so "tRPC-shaped but no `data`"
 * (or not tRPC-shaped at all) means the network is unreachable.
 */
export function isNetworkError(err: unknown): boolean {
	if (!(err instanceof Error)) return true
	if (!isTRPCClientError(err)) return true
	return err.data === undefined
}

/**
 * The server answered, and the entity is gone (`NOT_FOUND`, e.g. a
 * hard-deleted document). Distinct from {@link isNetworkError} so callers
 * can tell "this no longer exists" from "the request never landed" — the
 * document detail route leaves the page on the former and keeps showing
 * the last loaded content on the latter.
 *
 * NB: today's server collapses every `DomainError` into
 * `INTERNAL_SERVER_ERROR` (its tRPC error middleware never reaches
 * `toTRPCError`), so this classifier describes the intended contract and
 * not what the wire currently says; flows that must not wait for it react
 * at the source instead (see `DocTrashList`).
 */
export function isNotFoundError(err: unknown): boolean {
	if (!isTRPCClientError(err)) return false
	return err.data?.code === "NOT_FOUND"
}
