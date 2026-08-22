import type { QueryClient, QueryKey } from "@tanstack/react-query"

export type ListKeyset = {
	readonly all: QueryKey
	readonly detail?: (id: string) => QueryKey
}

/**
 * Build the canonical "invalidate every list under this domain + the
 * given detail, if any" callback used by mutation `onSuccess` handlers.
 * Returns a function with the same `(qc, id?) => Promise<void>` shape
 * each feature's hand-rolled invalidator exposes, so callsites do not
 * need to change.
 */
export function makeInvalidator(keys: ListKeyset) {
	return async function invalidate(
		qc: QueryClient,
		id?: string,
	): Promise<void> {
		await qc.invalidateQueries({ queryKey: keys.all })
		if (id !== undefined && keys.detail !== undefined) {
			await qc.invalidateQueries({ queryKey: keys.detail(id) })
		}
	}
}
