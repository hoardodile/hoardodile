import { useNavigate } from "@tanstack/react-router"
import { SearchField } from "@/components/common/SearchField"
import { ImageSearchButton } from "./ImageSearchButton"

type OverviewSearchBarProps = {
	readonly className?: string
}

/**
 * Overview hero search — the same global search field, rendered taller.
 * The global "/" and Ctrl/Cmd+K shortcuts live on the AppShell sidebar
 * field, not here.
 */
export function OverviewSearchBar(props: OverviewSearchBarProps) {
	const navigate = useNavigate()
	return (
		<div className={props.className} data-testid="overview-search-bar">
			<SearchField
				value=""
				className="h-11 gap-2.5 px-4"
				actions={<ImageSearchButton />}
				onSubmit={(query) => {
					const trimmed = query.trim()
					void navigate({
						to: "/search",
						search: {
							query: trimmed.length > 0 ? trimmed : undefined,
						},
					})
				}}
			/>
		</div>
	)
}
