import { Icon } from "@hoardodile/ui/components/icon"
import { GalleryAdd, RefreshCircle } from "@hoardodile/ui/icons/registry"
import { useNavigate } from "@tanstack/react-router"
import { type ChangeEvent, useRef } from "react"
import { useTranslation } from "react-i18next"
import { uploadImageSearchQuery } from "@/features/search/api"
import { useToastMutation } from "@/hooks/useToastMutation"

/**
 * Camera action for the trailing edge of a search field: opens a file
 * picker, uploads the chosen image as a reverse-image-search query
 * session, and navigates to `/search?imageSearch=<sessionId>` where the
 * results render. Every search bar (sidebar, overview hero, the search
 * page itself) shares this one entry point.
 */
export function ImageSearchButton() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const inputRef = useRef<HTMLInputElement>(null)
	const upload = useToastMutation({
		mutationFn: (file: File) => uploadImageSearchQuery(file),
		errorToastKey: "search.imageSearch.uploadFailed",
		onSuccess: ({ sessionId }) => {
			void navigate({
				to: "/search",
				search: { imageSearch: sessionId },
			})
		},
	})

	function handleFile(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0]
		// Reset so picking the same file again still fires `change`.
		event.target.value = ""
		if (file === undefined) return
		upload.mutate(file)
	}

	return (
		<>
			<button
				type="button"
				data-testid="image-search-button"
				title={t("search.imageSearch.button")}
				aria-label={t("search.imageSearch.button")}
				disabled={upload.isPending}
				onClick={() => inputRef.current?.click()}
				className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
			>
				{upload.isPending ? (
					<Icon icon={RefreshCircle} className="size-4 animate-spin" />
				) : (
					<Icon icon={GalleryAdd} className="size-4" />
				)}
			</button>
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				className="sr-only"
				data-testid="image-search-input"
				onChange={handleFile}
			/>
		</>
	)
}
