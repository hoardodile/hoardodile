import type { DocMoveBatchInput, DocSearchInput } from "@hoardodile/schemas"
import { type QueryClient, queryOptions } from "@tanstack/react-query"
import { trpcMutation, trpcQuery } from "@/trpc/factory"

export const docKeys = {
	all: ["document"] as const,
	tree: () => [...docKeys.all, "tree"] as const,
	workspace: () => [...docKeys.all, "workspace"] as const,
	children: (parentId: string | undefined) =>
		[...docKeys.all, "children", parentId ?? "root"] as const,
	detail: (id: string) => [...docKeys.all, "detail", id] as const,
	nodeView: (id: string) => [...docKeys.all, "nodeView", id] as const,
	detailPage: (id: string) => [...docKeys.all, "detailPage", id] as const,
	versions: (docId: string) => [...docKeys.all, "versions", docId] as const,
	version: (versionId: string) =>
		[...docKeys.all, "version", versionId] as const,
	search: (input: object) => [...docKeys.all, "search", input] as const,
} as const

export function docTreeQueryOptions() {
	return queryOptions({
		queryKey: docKeys.tree(),
		queryFn: () => trpcQuery("document", "tree"),
		staleTime: 2_000,
	})
}

export function docWorkspaceQueryOptions() {
	return queryOptions({
		queryKey: docKeys.workspace(),
		queryFn: () => trpcQuery("document", "workspace"),
		staleTime: 2_000,
	})
}

export function docNodeViewQueryOptions(id: string) {
	return queryOptions({
		queryKey: docKeys.nodeView(id),
		queryFn: () => trpcQuery("document", "nodeView", { id }),
		staleTime: 2_000,
	})
}

export function docDetailPageQueryOptions(id: string) {
	return queryOptions({
		queryKey: docKeys.detailPage(id),
		queryFn: () => trpcQuery("document", "detailPage", { id }),
		staleTime: 2_000,
	})
}

export function docVersionQueryOptions(docId: string, versionId: string) {
	return queryOptions({
		queryKey: docKeys.version(versionId),
		queryFn: () => trpcQuery("document", "getVersion", { docId, versionId }),
		staleTime: 60_000,
	})
}

export function docSearchQueryOptions(input: DocSearchInput) {
	return queryOptions({
		queryKey: docKeys.search(input),
		queryFn: () => trpcQuery("document", "search", input),
		staleTime: 1_000,
	})
}

export async function invalidateDocuments(
	qc: QueryClient,
	id?: string,
): Promise<void> {
	await qc.invalidateQueries({ queryKey: docKeys.all })
	if (id !== undefined) {
		await qc.invalidateQueries({ queryKey: docKeys.detail(id) })
		await qc.invalidateQueries({ queryKey: docKeys.nodeView(id) })
		await qc.invalidateQueries({ queryKey: docKeys.detailPage(id) })
	}
}

export function createDocumentNodeMutation() {
	return trpcMutation("document", "create")
}

export function renameDocumentNodeMutation() {
	return trpcMutation("document", "rename")
}

export function softDeleteDocumentMutation() {
	return trpcMutation("document", "softDelete", {
		transform: (id: string) => ({ id }),
	})
}

export function restoreDocumentMutation() {
	return trpcMutation("document", "restore", {
		transform: (id: string) => ({ id }),
	})
}

export function hardDeleteDocumentMutation() {
	return trpcMutation("document", "hardDelete", {
		transform: (id: string) => ({ id }),
	})
}

export function patchDraftMutation() {
	return trpcMutation("document", "patchDraft")
}

export function discardDraftMutation() {
	return trpcMutation("document", "discardDraft", {
		transform: (id: string) => ({ id }),
	})
}

export function commitDraftMutation() {
	return trpcMutation("document", "commitDraft")
}

export function moveBatchMutation() {
	return trpcMutation("document", "moveBatch", {
		transform: (input: DocMoveBatchInput) => input,
	})
}
