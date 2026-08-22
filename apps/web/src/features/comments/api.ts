import type { CommentListInput, CommentThreadInput } from "@hoardodile/schemas"
import { queryOptions } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { trpcMutation, trpcQuery } from "@/trpc/factory"

export const commentKeys = {
	all: ["comment"] as const,
	list: (input: Record<string, unknown>) =>
		[...commentKeys.all, "list", input] as const,
	thread: (id: string, options: Omit<CommentThreadInput, "id">) =>
		[...commentKeys.all, "thread", id, options] as const,
	votes: (commentId: string) =>
		[...commentKeys.all, "votes", commentId] as const,
} as const

export function commentListQueryOptions(input: CommentListInput) {
	return queryOptions({
		queryKey: commentKeys.list({ ...input }),
		queryFn: () => trpcQuery("comment", "list", input),
		staleTime: 2_000,
	})
}

export function commentThreadQueryOptions(
	id: string,
	options: Omit<CommentThreadInput, "id"> = {},
) {
	return queryOptions({
		queryKey: commentKeys.thread(id, options),
		queryFn: () => trpcQuery("comment", "thread", { id, ...options }),
		staleTime: 2_000,
	})
}

export function commentVotesQueryOptions(commentId: string) {
	return queryOptions({
		queryKey: commentKeys.votes(commentId),
		queryFn: () => trpcQuery("comment", "votes", { commentId }),
		staleTime: 2_000,
	})
}

export const invalidateComments = makeInvalidator({ all: commentKeys.all })

export function createCommentMutation() {
	return trpcMutation("comment", "create")
}

export function softDeleteCommentMutation() {
	return trpcMutation("comment", "softDelete")
}

export function restoreCommentMutation() {
	return trpcMutation("comment", "restore")
}

export function hardDeleteCommentMutation() {
	return trpcMutation("comment", "hardDelete")
}

export function addCommentVoteMutation() {
	return trpcMutation("comment", "addVote")
}
