import {
	danmakuCreateInput,
	danmakuDeleteInput,
	danmakuListInput,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import type { DanmakuService } from "./service.ts"

/**
 * tRPC sub-router for the danmaku module. Every procedure is
 * auth-guarded.
 */
export function buildDanmakuRouter(service: DanmakuService) {
	return router({
		list: authedProcedure
			.input(danmakuListInput)
			.query(({ input }) => service.list(input)),
		create: writeProcedure
			.input(danmakuCreateInput)
			.mutation(({ input }) => service.create(input)),
		delete: writeProcedure
			.input(danmakuDeleteInput)
			.mutation(({ input }) => service.delete(input)),
	})
}

export type DanmakuRouter = ReturnType<typeof buildDanmakuRouter>
