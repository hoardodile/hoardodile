import { toast } from "@hoardodile/ui/components/toast"
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"

export type UseImageDeleteArgs = {
	readonly url: string
	/** Called after a successful DELETE to invalidate query caches. */
	readonly invalidate: () => Promise<void>
	/** Optional callback fired after invalidate completes. */
	readonly onDeleted?: () => void
}

export type UseImageDeleteResult = {
	/** Trigger the DELETE request. */
	readonly deleteImage: () => Promise<void>
	/** Whether a delete request is in flight. */
	readonly isDeleting: boolean
}

/**
 * Reusable hook for deleting an image via HTTP DELETE and refreshing
 * dependent queries. Used by character avatar/fullbody editors and
 * resource cover editors.
 */
export function useImageDelete(args: UseImageDeleteArgs): UseImageDeleteResult {
	const { url, invalidate, onDeleted } = args
	const { t } = useTranslation()
	const [isDeleting, setIsDeleting] = useState(false)

	const deleteImage = useCallback(async () => {
		setIsDeleting(true)
		try {
			const response = await fetch(url, {
				method: "DELETE",
				credentials: "include",
			})
			if (!response.ok) {
				const text = await response.text().catch(() => "")
				toast.add({ title: text || t("common.requestFailed"), type: "error" })
				return
			}
			await invalidate()
			onDeleted?.()
		} finally {
			setIsDeleting(false)
		}
	}, [url, invalidate, onDeleted, t])

	return { deleteImage, isDeleting }
}
