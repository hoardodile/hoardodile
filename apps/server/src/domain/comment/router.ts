import {
	commentCreateInput,
	commentHardDeleteInput,
	commentListInput,
	commentRestoreInput,
	commentSoftDeleteInput,
	commentThreadInput,
	commentVoteInput,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { CommentService } from "./service.ts"

/**
 * tRPC sub-router for the comment module. Every procedure is
 * auth-guarded.
 */
export function buildCommentRouter(service: CommentService) {
	return router({
		list: authedProcedure
			.input(commentListInput)
			.query(({ input }) => service.list(input)),
		thread: authedProcedure
			.input(commentThreadInput)
			.query(({ input }) => service.thread(input)),
		votes: authedProcedure
			.input(z.object({ commentId: z.string().min(1) }))
			.query(({ input }) => service.listVotesFor(input.commentId)),
		create: writeProcedure
			.input(commentCreateInput)
			.mutation(({ input }) => service.create(input)),
		softDelete: writeProcedure
			.input(commentSoftDeleteInput)
			.mutation(({ input }) => service.softDelete(input.id)),
		restore: writeProcedure
			.input(commentRestoreInput)
			.mutation(({ input }) => service.restore(input.id)),
		hardDelete: writeProcedure
			.input(commentHardDeleteInput)
			.mutation(({ input }) => service.hardDelete(input.id)),
		addVote: writeProcedure
			.input(commentVoteInput)
			.mutation(({ input }) => service.addVote(input)),
		cancelVote: writeProcedure
			.input(z.object({ voteId: z.string().min(1) }))
			.mutation(({ input }) => {
				return service.cancelVote(input.voteId)
			}),
	})
}

export type CommentRouter = ReturnType<typeof buildCommentRouter>
