import { authedProcedure, router } from "src/infra/trpc/core.ts"
import type { StorageService } from "./service.ts"

export type BuildStorageRouterDeps = {
	readonly service: StorageService
}

/**
 * tRPC sub-router for storage accounting. Every procedure is
 * auth-guarded; there are no write procedures — the overview is a
 * read-only report of what the archive occupies on disk.
 */
export function buildStorageRouter(deps: BuildStorageRouterDeps) {
	return router({
		overview: authedProcedure.query(() => deps.service.getOverview()),
	})
}
