import { MobileDrawer } from "@hoardodile/ui/components/mobile-drawer"
import { Separator } from "@hoardodile/ui/components/separator"
import { useBelowPanel, useBelowSidebar } from "@hoardodile/ui/hooks/use-mobile"
import {
	ChatRound,
	DocumentText,
	Gallery,
	HamburgerMenu,
	HomeAngle,
	InfoCircle,
	Settings,
	UndoRightRound,
	UsersGroupRounded,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import type { ComponentType } from "react"
import {
	type ReactNode,
	type Ref,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import { SearchField } from "@/components/common/SearchField"
import { DesktopCaptionBar } from "@/components/layout/DesktopCaptionBar"
import { DesktopUpdateBanner } from "@/components/layout/DesktopUpdateBanner"
import { charListCardsQueryOptions } from "@/features/char/api"
import { commentListQueryOptions } from "@/features/comments/api"
import { docTreeQueryOptions } from "@/features/doc/api"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"
import { resListCardsQueryOptions } from "@/features/res/api"
import { ImageSearchButton } from "@/features/search/components/ImageSearchButton"
import { syncSummaryQueryOptions } from "@/features/sync/api"
import { useStringPrefSync } from "@/hooks/usePrefSync"
import { useRouteScrollRestore } from "@/hooks/useRouteScrollRestore"
import { isHoardodileDesktop } from "@/lib/desktop"
import { prefKeys } from "@/lib/keys"
import { registerPanelSlot, usePanelSlotClaimed } from "./panelSlot"
import { SidebarStorageStrip } from "./SidebarStorageStrip"
import { SidebarModeProvider } from "./sidebarMode"
import { registerSidebarSlot, useSidebarSlotClaimed } from "./sidebarSlot"
import { registerTopbarSlot, useTopbarSlotClaimed } from "./topbarSlot"

type AppShellProps = {
	readonly children: ReactNode
}

/**
 * Left-sidebar shell: a fixed 264px sidebar (w-sidebar) plus
 * an independently scrolling main canvas. Below the sidebar breakpoint
 * (`max-sidebar`) the sidebar hides and its content moves into a drawer opened
 * from the main area's menu button — mid-size viewports keep the full
 * width for their content column. The login route renders without sidebar
 * chrome. On Electron the caption strip sits on the content column
 * (canvas + panel), not over the sidebar; login keeps it full-width.
 */
export function AppShell(props: AppShellProps) {
	const routerState = useRouterState({
		select: (state) => ({
			pathname: state.location.pathname,
			loading: state.isLoading || state.status === "pending",
		}),
	})
	const isLoginRoute = routerState.pathname === "/login"
	const isDocumentsRoute = routerState.pathname.startsWith("/documents")
	const { themeClass } = useDocTheme()
	const isMobile = useBelowSidebar()
	const belowPanel = useBelowPanel()
	const panelClaimed = usePanelSlotClaimed()
	const topbarClaimed = useTopbarSlotClaimed()
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [moduleVisible, setModuleVisible] = useState(true)
	const searchInputRef = useRef<HTMLInputElement>(null)

	// Restore the app scroll container's position on back / forward
	// navigation (sessionStorage, per route); document and plugin reader
	// pages manage their own positions and are skipped inside.
	useRouteScrollRestore()

	// A claimed sidebar slot (e.g. the documents tree) opens in module view;
	// any route change returns to it.
	useEffect(() => {
		setModuleVisible(true)
	}, [routerState.pathname])

	// Global search shortcuts: "/" and Ctrl/Cmd+K focus the sidebar field.
	useEffect(() => {
		function handleKeyDown(ev: KeyboardEvent) {
			const target = ev.target
			const isTyping =
				target instanceof HTMLElement &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			if (
				!isTyping &&
				(ev.key === "/" || (ev.key === "k" && (ev.metaKey || ev.ctrlKey)))
			) {
				ev.preventDefault()
				searchInputRef.current?.focus()
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [])

	const sidebarModeValue = useMemo(
		function buildSidebarMode() {
			return {
				moduleVisible,
				showMainMenu() {
					setModuleVisible(false)
				},
				showModule() {
					setModuleVisible(true)
				},
			}
		},
		[moduleVisible],
	)

	if (isLoginRoute) {
		if (!isHoardodileDesktop()) return <>{props.children}</>
		return (
			<div className="flex h-full min-h-0 flex-col">
				<DesktopCaptionBar />
				<DesktopUpdateBanner />
				<div className="min-h-0 flex-1 overflow-hidden">{props.children}</div>
			</div>
		)
	}

	function closeDrawer() {
		setDrawerOpen(false)
	}

	return (
		<div
			className={cn(
				"relative flex bg-background text-foreground",
				isHoardodileDesktop() ? "h-full min-h-0" : "h-svh",
				isDocumentsRoute && themeClass,
			)}
		>
			<NavigationProgress visible={routerState.loading} />
			<aside
				data-testid="app-sidebar"
				className="hidden w-sidebar shrink-0 bg-background sidebar:flex"
			>
				<SidebarContent
					pathname={routerState.pathname}
					active={!isMobile}
					moduleVisible={moduleVisible}
					onShowModule={sidebarModeValue.showModule}
					searchInputRef={searchInputRef}
				/>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				{/* Below the sidebar breakpoint the global sidebar toggle sits
				    in the caption strip's leftmost slot (desktop only); the
				    caption strip is absent in a browser tab. */}
				<DesktopCaptionBar
					leading={
						isMobile ? (
							<SidebarMenuButton caption onClick={() => setDrawerOpen(true)} />
						) : undefined
					}
				/>
				<DesktopUpdateBanner />
				<div className="flex min-h-0 min-w-0 flex-1">
					<div className="flex min-w-0 flex-1 flex-col">
						{/* The top row hosts route chrome (e.g. the document
						    detail header's compact actions). In the browser it
						    always renders with the drawer hamburger; on desktop
						    the hamburger lives in the caption strip, so the row
						    exists only while a route claims it. */}
						{(!isHoardodileDesktop() || topbarClaimed) && (
							<div className="flex h-12 shrink-0 items-center gap-1 px-2 sidebar:hidden">
								{!isHoardodileDesktop() && (
									<SidebarMenuButton onClick={() => setDrawerOpen(true)} />
								)}
								{/* Route chrome (e.g. the document detail header)
								    portals its compact mobile actions here instead
								    of rendering a second bar below this one. */}
								<div
									ref={registerTopbarSlot}
									data-topbar-slot=""
									className="flex flex-1 items-center gap-1"
								/>
							</div>
						)}
						{/* The app's single always-on scrollbar lives here (formerly a
						    global `body { overflow-y: scroll }` in index.html): it keeps
						    the bar present so modal scroll-locking can't shift the layout
						    and the first paint never flickers, without stacking a second
						    viewport scrollbar. `data-app-scroll` marks it as the scroll
						    container for consumers like the doc reading anchor. */}
						<main
							data-app-scroll=""
							className="min-w-0 flex-1 overflow-y-scroll"
						>
							{/* Portaled sidebar modules (the documents tree) stay React
							    descendants of the routed content, so the provider here
							    still reaches them. */}
							<SidebarModeProvider value={sidebarModeValue}>
								{props.children}
							</SidebarModeProvider>
						</main>
					</div>
					{/* Right panel column: rendered only while a route claims
					    it (filter rails, character/resource detail, document
					    outline). Sibling of `<main>` so the page scrollbar
					    stays on the canvas; the claimer scrolls inside. */}
					{panelClaimed ? (
						<aside
							data-testid="app-filter-panel"
							ref={belowPanel ? undefined : registerPanelSlot}
							data-panel-slot={belowPanel ? undefined : ""}
							className="hidden min-h-0 w-panel shrink-0 flex-col bg-background panel:flex"
						/>
					) : null}
				</div>
			</div>
			<MobileDrawer
				open={drawerOpen}
				onOpenChange={setDrawerOpen}
				width="w-sidebar"
				hideAbove="sidebar:hidden"
				className="bg-background"
			>
				<SidebarContent
					pathname={routerState.pathname}
					active={isMobile}
					moduleVisible={moduleVisible}
					onShowModule={sidebarModeValue.showModule}
					onNavigate={closeDrawer}
				/>
			</MobileDrawer>
		</div>
	)
}

type NavigationProgressProps = {
	readonly visible: boolean
}

/**
 * Global sidebar toggle: opens the drawer below the sidebar breakpoint.
 * `caption: true` renders it as a caption-strip chrome button (full-height
 * `h-nav` square, no rounding — matches back/forward/reload in the strip);
 * the default is the top-row button.
 */
function SidebarMenuButton(props: {
	readonly onClick: () => void
	readonly caption?: boolean
}) {
	const { t } = useTranslation()
	return (
		<button
			type="button"
			aria-label={t("appShell.openMenu")}
			data-testid="app-sidebar-open"
			className={
				props.caption === true
					? "flex h-nav w-[46px] items-center justify-center text-secondary-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0"
					: "flex size-9 items-center justify-center rounded-lg text-secondary-foreground transition-colors duration-150 hover:bg-muted"
			}
			onClick={props.onClick}
		>
			<HamburgerMenu className="size-4" strokeWidth={1.6} />
		</button>
	)
}

function NavigationProgress(props: NavigationProgressProps) {
	return (
		<div
			className={cn(
				"absolute inset-x-0 top-0 z-50 h-0.5 bg-primary transition-opacity duration-150",
				props.visible ? "opacity-100" : "pointer-events-none opacity-0",
			)}
			aria-hidden="true"
		/>
	)
}

type SidebarContentProps = {
	readonly pathname: string
	/**
	 * Whether this instance is the visible one. Only the active instance
	 * registers the `data-sidebar-slot` container (desktop at md+, drawer
	 * below md), keeping the slot unique for `useSidebarSlot` consumers.
	 */
	readonly active: boolean
	/**
	 * While a route module claims the slot, whether the sidebar shows the
	 * module (true) or the main menu (false). Shared by both instances.
	 */
	readonly moduleVisible: boolean
	readonly onShowModule: () => void
	readonly searchInputRef?: Ref<HTMLInputElement>
	readonly onNavigate?: () => void
}

function SidebarContent(props: SidebarContentProps) {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const slotClaimed = useSidebarSlotClaimed()
	const syncAlert = useSyncAlert()
	// Claimed slot (e.g. the documents tree): toggle between the module and
	// the main menu. Unclaimed: the main menu, as before.
	const moduleView = slotClaimed && props.moduleVisible
	const mainMenuView = slotClaimed && !props.moduleVisible
	return (
		<div className="flex min-h-0 flex-1 flex-col px-3 pt-4.5">
			<div className="flex shrink-0 items-center gap-2 px-1">
				<img
					src="/logo.png"
					alt=""
					width={28}
					height={28}
					className="size-7 rounded-md object-cover"
					decoding="async"
				/>
				<span className="text-sm font-semibold text-foreground">
					Hoardodile
				</span>
				<BrandSyncStatus />
			</div>
			{/* The module owns its own search and its own way back to the main
			    menu (e.g. the documents tree's footer), so the shell's search
			    field only appears in the main menu view. */}
			{!moduleView && (
				<SearchField
					value=""
					className="mt-3"
					inputRef={props.searchInputRef}
					placeholder={t("search.placeholderShort")}
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
			)}
			{/* Context escape hatch sits right under search — an ordinary
			    sidebar row closed off by a 2px structural seam (DESIGN —
			    Borders). */}
			{mainMenuView && (
				<div className="mt-2">
					<button
						type="button"
						data-testid="sidebar-show-module"
						onClick={props.onShowModule}
						className="flex h-nav w-full items-center gap-3 rounded-lg px-3 text-ui font-medium text-secondary-foreground hover:bg-muted"
					>
						<UndoRightRound className="size-4 shrink-0" strokeWidth={1.6} />
						<span className="truncate">
							{t("appShell.backToDocumentsMenu")}
						</span>
					</button>
					<Separator size="seam" className="mt-2" />
				</div>
			)}
			{/* Main-menu view over a claimed module: the nav is the only
			    region that grows, so it gets the scrollbar while the
			    settings/storage footer stays pinned to the bottom edge. */}
			{mainMenuView && (
				<div className="strip-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
					<DefaultNav
						pathname={props.pathname}
						onNavigate={props.onNavigate}
						onShowModule={props.onShowModule}
					/>
				</div>
			)}
			<div
				ref={props.active ? registerSidebarSlot : undefined}
				data-sidebar-slot={props.active ? "" : undefined}
				// Hidden — not unmounted — in main menu view so the portaled
				// module keeps its state. Below the module breakpoint the
				// same container is the scroll region for the default nav.
				className={cn(
					"flex min-h-0 flex-1 flex-col",
					mainMenuView && "hidden",
					moduleView
						? "overflow-hidden"
						: "strip-scroll overflow-y-auto overscroll-contain pb-2",
				)}
			>
				{!slotClaimed && (
					<DefaultNav
						pathname={props.pathname}
						onNavigate={props.onNavigate}
						onShowModule={props.onShowModule}
					/>
				)}
			</div>
			{!moduleView && (
				<div className="mt-auto shrink-0 pb-3">
					<nav
						aria-label={t("appShell.secondaryNav")}
						className="flex flex-col gap-1"
					>
						<NavRow
							to="/settings"
							icon={Settings}
							label={t("appShell.nav.me")}
							active={
								isRouteActive({
									pathname: props.pathname,
									to: "/settings",
								}) &&
								// The Feedback & About row owns the About tab —
								// one highlight per destination.
								!props.pathname.startsWith("/settings/about")
							}
							alert={syncAlert}
							onNavigate={props.onNavigate}
						/>
						<NavRow
							to="/settings/about"
							icon={InfoCircle}
							label={t("appShell.nav.feedbackAbout")}
							active={isRouteActive({
								pathname: props.pathname,
								to: "/settings/about",
							})}
							onNavigate={props.onNavigate}
						/>
					</nav>
					<SidebarStorageStrip onNavigate={props.onNavigate} />
				</div>
			)}
		</div>
	)
}

/**
 * Brand-row sync health: a status dot (green when healthy, red when a
 * device is due or none is configured) and a quiet label, opening
 * Settings → Sync (DESIGN — Brand).
 */
function BrandSyncStatus() {
	const { t } = useTranslation()
	const summary = useQuery(syncSummaryQueryOptions()).data
	if (summary === undefined) {
		return null
	}
	const dueCount = summary.devices.filter((entry) => entry.due).length
	const due = summary.devices.length === 0 || dueCount > 0
	const label = due
		? t("appShell.syncStatus.due")
		: t("appShell.syncStatus.synced")
	const title = due
		? summary.devices.length === 0
			? t("appShell.syncStatus.noDevicesTitle")
			: t("appShell.syncStatus.dueTitle", { count: dueCount })
		: t("appShell.syncStatus.syncedTitle", { count: summary.devices.length })
	return (
		<Link
			to="/settings/sync"
			title={title}
			className="ml-auto flex items-center gap-1.5"
		>
			<span
				className={cn(
					"size-1.5 rounded-full",
					due ? "bg-destructive" : "bg-emerald-500",
				)}
				aria-hidden="true"
			/>
			<span
				className={cn(
					"text-tiny",
					due
						? "text-destructive"
						: "text-muted-foreground hover:text-secondary-foreground",
				)}
			>
				{label}
			</span>
		</Link>
	)
}

/** Settings-row warning dot: shown while a sync reminder is due. */
function useSyncAlert(): boolean {
	const summary = useQuery(syncSummaryQueryOptions()).data
	return (
		summary !== undefined &&
		(summary.devices.length === 0 || summary.devices.some((entry) => entry.due))
	)
}

type NavAreaProps = {
	readonly pathname: string
	readonly onNavigate?: () => void
	readonly onShowModule?: () => void
	readonly className?: string
}

function DefaultNav(props: NavAreaProps) {
	const { t } = useTranslation()
	const counts = useNavCounts()
	return (
		<nav
			aria-label={t("appShell.primaryNav")}
			className={cn("mt-4 flex flex-col gap-1", props.className)}
		>
			<NavRow
				to="/"
				icon={HomeAngle}
				label={t("appShell.nav.overview")}
				active={isRouteActive({ pathname: props.pathname, to: "/" })}
				onNavigate={props.onNavigate}
			/>
			<NavRow
				to="/characters"
				icon={UsersGroupRounded}
				label={t("appShell.nav.characters")}
				active={isRouteActive({ pathname: props.pathname, to: "/characters" })}
				count={counts.characters}
				onNavigate={props.onNavigate}
			/>
			<NavRow
				to="/resources"
				icon={Gallery}
				label={t("appShell.nav.resources")}
				active={isRouteActive({ pathname: props.pathname, to: "/resources" })}
				count={counts.resources}
				onNavigate={props.onNavigate}
			/>
			<DocNavRow
				pathname={props.pathname}
				count={counts.documents}
				onNavigate={props.onNavigate}
				onShowModule={props.onShowModule}
			/>
			<NavRow
				to="/messages"
				icon={ChatRound}
				label={t("appShell.nav.messages")}
				active={isRouteActive({ pathname: props.pathname, to: "/messages" })}
				count={counts.messages}
				onNavigate={props.onNavigate}
			/>
		</nav>
	)
}

type NavCounts = {
	readonly characters?: number
	readonly resources?: number
	readonly documents?: number
	readonly messages?: number
}

/**
 * Sidebar row counts. Each query uses a minimal page size and the shared
 * query keys, so the counts ride the same cache as the list pages. While
 * a query is pending its count stays undefined and the row renders none.
 */
function useNavCounts(): NavCounts {
	const charactersQuery = useQuery(
		charListCardsQueryOptions({
			query: "",
			page: 1,
			size: 1,
			sortBy: "updated",
			order: "desc",
		}),
	)
	const resourcesQuery = useQuery(
		resListCardsQueryOptions({
			query: "",
			page: 1,
			size: 1,
			sortBy: "updated",
			order: "desc",
		}),
	)
	const docsQuery = useQuery(docTreeQueryOptions())
	const messagesQuery = useQuery(
		commentListQueryOptions({
			page: 1,
			size: 1,
			sortBy: "newest",
			trashed: false,
		}),
	)
	return {
		characters: charactersQuery.data?.total,
		resources: resourcesQuery.data?.total,
		documents: docsQuery.data?.filter((node) => node.kind === "document")
			.length,
		messages: messagesQuery.data?.totalAll ?? messagesQuery.data?.total,
	}
}

type NavPath =
	| "/"
	| "/resources"
	| "/characters"
	| "/messages"
	| "/settings"
	| "/settings/about"

type NavRowProps = {
	readonly to: NavPath
	readonly icon: ComponentType<{ className?: string }>
	readonly label: string
	readonly active: boolean
	readonly count?: number
	/**
	 * When true, renders a small warning dot at the row's end (used by the
	 * settings row while a sync reminder is due).
	 */
	readonly alert?: boolean
	readonly onNavigate?: () => void
}

function NavRow(props: NavRowProps) {
	const Icon = props.icon
	const { t } = useTranslation()
	return (
		<Link
			to={props.to}
			aria-current={props.active ? "page" : undefined}
			onClick={props.onNavigate}
			className={navRowClassName(props.active)}
		>
			<Icon className="size-4 shrink-0" />
			<span className="truncate">{props.label}</span>
			{props.alert === true ? (
				<span
					className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive"
					role="img"
					aria-label={t("appShell.syncDueBadge")}
				/>
			) : null}
			{props.count !== undefined && (
				<span className="ml-auto text-tiny font-normal text-muted-foreground">
					{props.count}
				</span>
			)}
		</Link>
	)
}

type DocNavRowProps = {
	readonly pathname: string
	readonly count?: number
	readonly onNavigate?: () => void
	readonly onShowModule?: () => void
}

/**
 * Documents entry points at the user's last location inside the section:
 * the last opened document, or the documents home when that was the last
 * place visited (recorded as the empty value — see `useDocsHomeLastOpened`).
 */
function DocNavRow(props: DocNavRowProps) {
	const { t } = useTranslation()
	const [lastDocId] = useStringPrefSync(prefKeys.docLastOpened, "")
	const active = isRouteActive({ pathname: props.pathname, to: "/documents" })
	const label = t("appShell.nav.documents")
	const className = navRowClassName(active)
	const count =
		props.count !== undefined ? (
			<span className="ml-auto text-tiny font-normal text-muted-foreground">
				{props.count}
			</span>
		) : null

	function handleClick() {
		// Already inside /documents (main menu over a claimed slot): return
		// to the document module. The Link navigation still happens.
		if (active) {
			props.onShowModule?.()
		}
		props.onNavigate?.()
	}

	if (lastDocId.length > 0) {
		return (
			<Link
				to="/documents/$id"
				params={{ id: lastDocId }}
				aria-current={active ? "page" : undefined}
				onClick={handleClick}
				className={className}
			>
				<DocumentText className="size-4 shrink-0" strokeWidth={1.6} />
				<span className="truncate">{label}</span>
				{count}
			</Link>
		)
	}

	return (
		<Link
			to="/documents"
			aria-current={active ? "page" : undefined}
			onClick={handleClick}
			className={className}
		>
			<DocumentText className="size-4 shrink-0" strokeWidth={1.6} />
			<span className="truncate">{label}</span>
			{count}
		</Link>
	)
}

function navRowClassName(active: boolean) {
	return cn(
		"flex h-nav items-center gap-3 rounded-lg px-3 text-ui font-medium",
		active
			? "bg-muted text-foreground"
			: "text-secondary-foreground hover:bg-muted",
	)
}

type RouteActivityInput = {
	readonly pathname: string
	readonly to: string
}

function isRouteActive(input: RouteActivityInput) {
	if (input.to === "/") {
		return input.pathname === "/"
	}

	return (
		input.pathname === input.to || input.pathname.startsWith(`${input.to}/`)
	)
}
