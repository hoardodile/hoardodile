import { Icon } from "@hoardodile/ui/components/icon"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
	SETTINGS_TABS,
	type SettingsTabKey,
	visibleSettingsTabs,
} from "@/features/settings/settingsTabs"
import { syncSummaryQueryOptions } from "@/features/sync/api"
import { requireAuth } from "@/lib/auth-guard"
import { isHoardodileDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/settings")({
	beforeLoad: requireAuth,
	component: SettingsLayout,
})

/**
 * Settings layout — the in-page settings shell: a 208px icon nav column
 * (the sync row shows a red dot when a device is due) beside the content
 * column. The tab bar renders once and each tab owns its route, so
 * back/forward navigation and deep links work across sections. The
 * desktop-only tab drops out of a normal browser tab.
 */
function SettingsLayout() {
	const { t } = useTranslation()
	const { pathname } = useLocation()
	const rawSuffix =
		pathname.replace(/\/$/, "").split("/").pop() ?? "preferences"
	const suffix =
		rawSuffix === "backups"
			? "archive"
			: rawSuffix === "app"
				? "data"
				: rawSuffix
	const activeKey = SETTINGS_TABS.some((tab) => tab.key === suffix)
		? (suffix as SettingsTabKey)
		: "preferences"

	const syncSummaryQuery = useQuery(syncSummaryQueryOptions())
	const syncDue =
		(syncSummaryQuery.data?.devices ?? []).some((entry) => entry.due) === true
	const tabs = visibleSettingsTabs(isHoardodileDesktop())

	return (
		<PageScaffold width="content">
			{/* Stack on mobile (strip above content); side by side from the
			    sidebar breakpoint — the row layout must not squeeze the two
			    columns. */}
			<div className="flex flex-col gap-8 sidebar:flex-row sidebar:gap-12">
				{/* Mobile: horizontal strip with a strong bottom edge, scrolls on overflow. */}
				<SectionTabs
					value={activeKey}
					className="sidebar:hidden"
					items={tabs.map((tab) => ({
						value: tab.key,
						label: t(`me.tabs.${tab.key}`),
						testId: tab.testId,
						render: (active, className, trigger) => (
							<Link
								{...trigger}
								to={tab.path}
								resetScroll={false}
								className={className}
								aria-current={active ? "page" : undefined}
							>
								{t(`me.tabs.${tab.key}`)}
							</Link>
						),
					}))}
				/>
				{/* Desktop: the settings nav — icon + label rows, the
				    selected row lifts to a muted fill; sync shows a red dot.
				    Sticky so it stays in view while the content column
				    scrolls (self-start keeps the column from stretching). */}
				<nav className="sticky top-4.5 z-20 hidden w-52 shrink-0 flex-col gap-1 self-start sidebar:flex">
					{tabs.map((tab) => {
						const active = tab.key === activeKey
						return (
							<Link
								key={tab.key}
								to={tab.path}
								resetScroll={false}
								className={cn(
									"flex h-nav w-full items-center gap-3 rounded-lg px-3 text-ui font-medium",
									active
										? "bg-muted text-foreground"
										: "text-secondary-foreground hover:bg-muted",
								)}
								data-testid={tab.testId}
							>
								<Icon icon={tab.icon} selected={active} className="shrink-0" />
								{t(`me.tabs.${tab.key}`)}
								{tab.key === "sync" && syncDue ? (
									<span className="ml-auto size-2 shrink-0 rounded-full bg-destructive" />
								) : null}
							</Link>
						)
					})}
				</nav>
				{/* Centered in strip mode (the measure column can't stretch
				    beyond max-w-medium); beside the nav at `sidebar:`. */}
				<div className="mx-auto w-full max-w-medium min-w-0 flex-1 sidebar:mx-0">
					<Outlet />
				</div>
			</div>
		</PageScaffold>
	)
}
