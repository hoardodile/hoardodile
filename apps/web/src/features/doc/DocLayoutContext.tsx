import { createContext, useContext } from "react"

export type DocLayoutValue = {
	readonly readingView: boolean
	readonly toggleReadingView: () => void
}

/**
 * Bridge between the documents shell and the active document detail
 * page. The detail route (rendered inside the layout's `<Outlet />`)
 * reads the immersive reading-view state and its toggle without
 * prop-drilling through router APIs.
 */
export const DocLayoutContext = createContext<DocLayoutValue | undefined>(
	undefined,
)

/** Reads the {@link DocLayoutContext} from inside the documents shell. */
export function useDocLayout(): DocLayoutValue | undefined {
	return useContext(DocLayoutContext)
}
