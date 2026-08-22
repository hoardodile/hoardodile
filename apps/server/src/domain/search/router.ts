import { searchGlobalInput } from "@hoardodile/schemas"
import { authedProcedure, router } from "src/infra/trpc/core.ts"
import type { SearchService } from "./service.ts"

export function buildSearchRouter(service: SearchService) {
	return router({
		global: authedProcedure
			.input(searchGlobalInput)
			.query(({ input }) => service.globalSearch(input)),
	})
}
