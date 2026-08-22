import { useEffect } from "react"
import { useStringPrefSync } from "@/hooks/usePrefSync"
import { prefKeys } from "@/lib/keys"

/**
 * The documents home is itself a valid "last opened" location: while it is
 * shown, record it so the top-nav documents entry keeps landing here instead
 * of jumping back to the previously opened document. The home is stored as
 * the empty value — the same state as "no recent document".
 */
export function useDocsHomeLastOpened(): void {
	const [lastOpenedId, setLastOpenedId] = useStringPrefSync(
		prefKeys.docLastOpened,
		"",
	)

	useEffect(() => {
		if (lastOpenedId !== "") setLastOpenedId("")
	}, [lastOpenedId, setLastOpenedId])
}
