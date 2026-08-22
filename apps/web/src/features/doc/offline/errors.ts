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
