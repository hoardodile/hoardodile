import { PageHeader } from "@hoardodile/ui/components/page-header"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import type { ReactNode } from "react"
import { CurrentPlatformPill } from "@/features/usage/components/CurrentPlatformPill"
import { PlatformFilterSelect } from "@/features/usage/components/PlatformFilterSelect"
import type { UsagePlatformFilterValue } from "@/features/usage/components/UsagePlatformFilter"

type PlatformFilterPageProps = {
	readonly title: ReactNode
	readonly description?: string
	readonly platform: UsagePlatformFilterValue
	readonly onPlatformChange: (value: UsagePlatformFilterValue) => void
	/** Extra header actions rendered after the platform filter (stats). */
	readonly extraActions?: ReactNode
	readonly children: ReactNode
}

/**
 * Page shell for the platform-filtered pages (usage stats, footprints,
 * usage history): the content scaffold with a titled header whose actions
 * are the current-platform pill plus the platform filter (and optional
 * extras). The platform value lives in the route's URL search on every
 * page, so filtering is shareable and deep-linkable.
 */
export function PlatformFilterPage(props: PlatformFilterPageProps) {
	const { title, description, platform, onPlatformChange, extraActions } = props
	return (
		<PageScaffold width="content">
			<PageHeader
				title={title}
				description={description}
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<CurrentPlatformPill />
						<PlatformFilterSelect
							value={platform}
							onChange={onPlatformChange}
						/>
						{extraActions}
					</div>
				}
			/>
			{props.children}
		</PageScaffold>
	)
}
