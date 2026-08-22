import { useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"

export type UseDocsSidebarModesResult = {
	readonly filter: string
	readonly setFilter: (next: string) => void
	readonly isSearching: boolean
	readonly trashMode: boolean
	readonly handleToggleTrash: () => void
	readonly editMode: boolean
	readonly setEditMode: (next: boolean) => void
	readonly readingView: boolean
	readonly toggleReadingView: () => void
}

/**
 * Sidebar mode state for the documents layout: the search filter, trash,
 * edit and immersive reading modes. The modes are mutually exclusive —
 * entering reading view leaves trash and search behind, typing clears
 * trash — so the exclusivity rules live here instead of the layout.
 *
 * The search field debounces its commits upstream (the shared SearchField),
 * so the filter is already settled by the time it lands here.
 */
export function useDocsSidebarModes(args: {
	readonly filter: string
}): UseDocsSidebarModesResult {
	const { filter } = args
	const navigate = useNavigate()
	const [trashMode, setTrashMode] = useState(false)
	const [editMode, setEditMode] = useState(false)
	const [readingView, setReadingView] = useState(false)

	const setFilter = useCallback(
		function setFilter(next: string) {
			if (next.length > 0) setTrashMode(false)
			navigate({
				to: ".",
				search: (prev) => ({
					...(prev ?? {}),
					filter: next.length > 0 ? next : undefined,
				}),
				replace: true,
			})
		},
		[navigate],
	)

	const handleToggleTrash = useCallback(
		function handleToggleTrash() {
			if (!trashMode) setFilter("")
			setTrashMode((v) => !v)
		},
		[trashMode, setFilter],
	)

	// Immersive reading is exclusive with the sidebar utilities: entering
	// it leaves trash/search.
	const toggleReadingView = useCallback(
		function toggleReadingView() {
			if (!readingView) {
				setTrashMode(false)
				if (filter.length > 0) setFilter("")
			}
			setReadingView(!readingView)
		},
		[readingView, filter, setFilter],
	)

	return {
		filter,
		setFilter,
		isSearching: filter.trim().length > 0,
		trashMode,
		handleToggleTrash,
		editMode,
		setEditMode,
		readingView,
		toggleReadingView,
	}
}
