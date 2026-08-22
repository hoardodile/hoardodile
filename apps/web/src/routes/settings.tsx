import type { IconType } from "@hoardodile/ui/components/icon"
import { Icon } from "@hoardodile/ui/components/icon"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import {
	Archive,
	PlugCircle,
	RefreshCircle,
	ShieldCheck,
	SliderHorizontal,
	Star,
	WindowFrame,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { syncSummaryQueryOptions } from "@/features/sync/api"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/settings")({
	beforeLoad: requireAuth,
	component: SettingsLayout,
})

type TabKey =
	| "preferences"
	| "app"
	| "custom"
	| "privacy"
	| "archive"
	| "plugins"
	| "sync"

type TabDef = {
	readonly key: TabKey
	readonly path:
		| "/settings"
		| "/settings/app"
		| "/settings/custom"
		| "/settings/privacy"
		| "/settings/backups"
		| "/settings/plugins"
		| "/settings/sync"
	readonly icon: IconType
	readonly testId: string
}

const TABS: readonly TabDef[] = [
	{
		key: "preferences",
		path: "/settings",
		icon: SliderHorizontal,
		testId: "me-tab-preferences",
	},
	{
		key: "app",
		path: "/settings/app",
		icon: WindowFrame,
		testId: "me-tab-app",
	},
	{
		key: "custom",
		path: "/settings/custom",
		icon: Star,
		testId: "me-tab-custom",
	},
	{
		key: "privacy",
		path: "/settings/privacy",
		icon: ShieldCheck,
		testId: "me-tab-privacy",
	},
	{
		key: "archive",
		path: "/settings/backups",
		icon: Archive,
		testId: "me-tab-archive",
	},
	{
		key: "plugins",
		path: "/settings/plugins",
		icon: PlugCircle,
		testId: "me-tab-plugins",
	},
	{
		key: "sync",
		path: "/settings/sync",
		icon: RefreshCircle,
		testId: "me-tab-sync",
	},
]

/**
 * Settings layout — the in-page settings shell: a 208px icon nav column
 * (the sync row shows a red dot when a device is due) beside the content
 * column. The tab bar renders once and each tab owns its route, so
 * back/forward navigation and deep links work across sections.
 */
function SettingsLayout() {
	const { t } = useTranslation()
	const { pathname } = useLocation()
	const rawSuffix =
		pathname.replace(/\/$/, "").split("/").pop() ?? "preferences"
	const suffix = rawSuffix === "backups" ? "archive" : rawSuffix
	const activeKey = TABS.some((tab) => tab.key === suffix)
		? (suffix as TabKey)
		: "preferences"

	const syncSummaryQuery = useQuery(syncSummaryQueryOptions())
	const syncDue =
		(syncSummaryQuery.data?.devices ?? []).some((entry) => entry.due) === true

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
					items={TABS.map((tab) => ({
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
					{TABS.map((tab) => {
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
