import { useCallback, useState } from "react"
import type { DocDraft } from "./useDocDraft"

export type UseDocCommitDialogsResult = {
	readonly commitOpen: boolean
	readonly setCommitOpen: (open: boolean) => void
	readonly commitMessage: string
	readonly setCommitMessage: (next: string) => void
	readonly discardOpen: boolean
	readonly setDiscardOpen: (open: boolean) => void
	readonly requestCommit: () => void
	readonly submitCommit: () => void
	readonly openDiscard: () => void
	readonly confirmDiscard: () => void
}

/**
 * Owns the commit/discard dialog state for a document detail route and
 * bridges it to the draft's commit/discard actions. The draft layer
 * decides whether a commit is allowed; this hook only renders the flows.
 */
export function useDocCommitDialogs(
	draft: DocDraft,
): UseDocCommitDialogsResult {
	const [commitOpen, setCommitOpen] = useState(false)
	const [commitMessage, setCommitMessage] = useState("")
	const [discardOpen, setDiscardOpen] = useState(false)

	const requestCommit = useCallback(
		function requestCommit() {
			draft.requestCommit(() => {
				setCommitMessage("")
				setCommitOpen(true)
			})
		},
		[draft.requestCommit],
	)

	const submitCommit = useCallback(
		function submitCommit() {
			draft.submitCommit(commitMessage, () => {
				setCommitOpen(false)
				setCommitMessage("")
			})
		},
		[draft.submitCommit, commitMessage],
	)

	const openDiscard = useCallback(function openDiscard() {
		setDiscardOpen(true)
	}, [])

	const confirmDiscard = useCallback(
		function confirmDiscard() {
			draft.confirmDiscard(() => setDiscardOpen(false))
		},
		[draft.confirmDiscard],
	)

	return {
		commitOpen,
		setCommitOpen,
		commitMessage,
		setCommitMessage,
		discardOpen,
		setDiscardOpen,
		requestCommit,
		submitCommit,
		openDiscard,
		confirmDiscard,
	}
}
