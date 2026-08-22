import type { DocDraft, DocVersion } from "@hoardodile/schemas"
import { toast } from "@hoardodile/ui/components/toast"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
	commitDraftMutation,
	discardDraftMutation,
	patchDraftMutation,
} from "../index.ts"
import { isNetworkError } from "../offline/errors.ts"
import {
	markNetworkOffline,
	markNetworkOnline,
} from "../offline/useOnlineStatus.ts"

export type UseDocDraftMutationsResult = {
	readonly patchMut: ReturnType<
		typeof useMutation<
			DocDraft,
			Error,
			{
				readonly id: string
				readonly title?: string
				readonly content?: Record<string, unknown>
			}
		>
	>
	readonly commitMut: ReturnType<
		typeof useMutation<
			DocVersion,
			Error,
			{ readonly id: string; readonly message?: string }
		>
	>
	readonly discardMut: ReturnType<typeof useMutation<DocDraft, Error, string>>
}

/**
 * Encapsulates the patch/commit/discard mutations for document drafts.
 *
 * Draft patches are unconditional (last writer wins) — no offline staging
 * or conflict resolution; a failed save surfaces through the toast and
 * the failure-based offline flag.
 *
 * Callers own the `onSuccess` callbacks (e.g. cache invalidation and local
 * buffer cleanup) because those actions depend on the current document id and
 * hook-local refs.
 */
export function useDocDraftMutations(): UseDocDraftMutationsResult {
	const { t } = useTranslation()

	const patchMut = useMutation({
		...patchDraftMutation(),
		onError: (err) => {
			if (isNetworkError(err)) markNetworkOffline()
			toast.add({
				title: err.message || t("documents.toast.saveFailed"),
				type: "error",
			})
		},
		onSuccess: () => markNetworkOnline(),
	})

	const commitMut = useMutation({
		...commitDraftMutation(),
		onError: (err) =>
			toast.add({
				title: err.message || t("documents.toast.commitFailed"),
				type: "error",
			}),
	})

	const discardMut = useMutation({
		...discardDraftMutation(),
	})

	return { patchMut, commitMut, discardMut }
}
