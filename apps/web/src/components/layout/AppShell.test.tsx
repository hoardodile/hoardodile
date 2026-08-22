import { SIDEBAR_QUERY } from "@hoardodile/ui/viewport"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router"
import { fireEvent, render, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import type { HoardodileDesktopBridge } from "@/lib/desktop"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { AppShell } from "./AppShell"
import { useClaimPanelSlot } from "./panelSlot"
import { useSidebarMode } from "./sidebarMode"
import { useClaimSidebarSlot } from "./sidebarSlot"

function createMockTrpcClient(
	handlers: Record<string, (input: unknown) => unknown>,
): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, namespace: string) {
				return new Proxy(
					{},
					{
						get(_, procedure: string) {
							return {
								query: async (input: unknown) => {
									const key = `${namespace}.${procedure}`
									const handler = handlers[key]
									if (handler) return handler(input)
									return undefined
								},
								mutate: async () => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

const baseHandlers = {
	"resource.listCards": () => ({ rows: [], total: 7, page: 1, size: 1 }),
	"character.listCards": () => ({ rows: [], total: 3, page: 1, size: 1 }),
	"document.tree": () => [
		{ id: "doc-1", kind: "document", title: "One", position: 0 },
		{ id: "doc-2", kind: "document", title: "Two", position: 1 },
		{ id: "folder-1", kind: "folder", title: "Folder", position: 2 },
	],
	"comment.list": () => ({ rows: [], total: 1, totalAll: 5 }),
	"storage.overview": () => ({
		volume: { totalBytes: 1024, freeBytes: 512 },
		usedBytes: 512,
		databaseBytes: 32,
		cacheBytes: 16,
		trashBytes: 8,
		archivedBytes: 128,
		backupBytes: 64,
		otherBytes: 4,
		lowSpace: false,
		resources: {
			totalBytes: 256,
			byPlugin: [
				{
					pluginId: "gallery",
					name: "Gallery",
					sizeBytes: 192,
					resourceCount: 10,
				},
			],
			unattributedBytes: 64,
			unattributedCount: 5,
		},
	}),
	"sync.summary": () => ({ remindDays: 7, devices: [] }),
}

beforeAll(() => {
	setTrpcClient(createMockTrpcClient(baseHandlers))
})

function renderAppShell(
	initialPath = "/",
	options: { claimSlot?: boolean; claimPanel?: boolean } = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: 0, gcTime: 0 },
		},
	})
	const rootRoute = createRootRoute({
		component: () => (
			<AppShell>
				{options.claimSlot ? <SidebarSlotClaimer /> : null}
				{options.claimPanel ? <PanelSlotClaimer /> : <div />}
			</AppShell>
		),
	})
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	})
	const loginRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/login",
		component: () => null,
	})
	const documentsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/documents",
		component: () => null,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, loginRoute, documentsRoute]),
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	)
}

/**
 * Stands in for a route module (e.g. the documents tree) claiming the slot.
 * Renders a context-driven main-menu trigger, mirroring how the tree's own
 * footer button switches the sidebar mode.
 */
function SidebarSlotClaimer() {
	useClaimSidebarSlot()
	const sidebarMode = useSidebarMode()
	return (
		<button
			type="button"
			data-testid="test-show-main-menu"
			onClick={sidebarMode?.showMainMenu}
		/>
	)
}

/**
 * Stands in for a route page (e.g. the characters index) claiming the
 * right filter-rail slot.
 */
function PanelSlotClaimer() {
	useClaimPanelSlot()
	return <div />
}

describe("AppShell sidebar", () => {
	it("renders the sidebar with brand, search, nav and footer links", async () => {
		const { container, findByTestId } = renderAppShell()
		await findByTestId("app-sidebar")

		const sidebar = container.querySelector('[data-testid="app-sidebar"]')
		expect(sidebar).not.toBeNull()
		expect(sidebar?.querySelector('img[src="/logo.png"]')).not.toBeNull()
		expect(
			sidebar?.querySelector('[data-testid="global-search-input"]'),
		).not.toBeNull()
		expect(sidebar?.querySelector('a[href="/characters"]')).not.toBeNull()
		expect(sidebar?.querySelector('a[href="/resources"]')).not.toBeNull()
		expect(sidebar?.querySelector('a[href="/messages"]')).not.toBeNull()
		expect(sidebar?.querySelector('a[href="/settings"]')).not.toBeNull()
		// The storage strip is the shell's way to Settings → Data.
		await waitFor(() => {
			expect(container.querySelector('a[href="/settings/data"]')).not.toBeNull()
		})
	})

	it("marks the overview row as current on /", async () => {
		const { container, findByTestId } = renderAppShell("/")
		await findByTestId("app-sidebar")

		const overview = container.querySelector(
			'[data-testid="app-sidebar"] a[href="/"]',
		)
		expect(overview?.getAttribute("aria-current")).toBe("page")
		expect(
			container
				.querySelector('[data-testid="app-sidebar"] a[href="/resources"]')
				?.getAttribute("aria-current"),
		).toBeNull()
	})

	it("exposes a single sidebar slot container", async () => {
		const { container, findByTestId } = renderAppShell()
		await findByTestId("app-sidebar")

		expect(container.querySelectorAll("[data-sidebar-slot]")).toHaveLength(1)
	})

	it("renders no filter panel while no route claims the rail slot", async () => {
		const { container, findByTestId } = renderAppShell()
		await findByTestId("app-sidebar")

		expect(
			container.querySelector('[data-testid="app-filter-panel"]'),
		).toBeNull()
	})

	it("renders the filter panel column with a single slot when claimed", async () => {
		const { container, findByTestId } = renderAppShell("/", {
			claimPanel: true,
		})
		await findByTestId("app-sidebar")

		const panel = container.querySelector('[data-testid="app-filter-panel"]')
		expect(panel).not.toBeNull()
		expect(container.querySelectorAll("[data-panel-slot]")).toHaveLength(1)
		expect(panel?.getAttribute("data-panel-slot")).not.toBeNull()
	})

	it("renders nav counts once the queries resolve", async () => {
		const { container, findByTestId } = renderAppShell()
		await findByTestId("app-sidebar")

		await waitFor(() => {
			expect(
				container.querySelector('a[href="/resources"]')?.textContent,
			).toContain("7")
		})
		expect(
			container.querySelector('a[href="/characters"]')?.textContent,
		).toContain("3")
		expect(
			container.querySelector('a[href="/messages"]')?.textContent,
		).toContain("5")
		// 2 of the 3 tree nodes are documents.
		expect(
			container.querySelector('nav a[href="/documents"]')?.textContent,
		).toContain("2")
	})
})

describe("AppShell documents nav", () => {
	it("links to the last opened document when one is recorded", async () => {
		prefSync.set(prefKeys.docLastOpened, "doc-123")

		const { container, findByTestId } = renderAppShell()
		await findByTestId("app-sidebar")

		expect(
			container.querySelector('nav a[href="/documents/doc-123"]'),
		).not.toBeNull()
	})

	it("links to the documents home when the home was the last location", async () => {
		// The home is recorded as the empty value (see useDocsHomeLastOpened).
		prefSync.set(prefKeys.docLastOpened, "")

		const { container, findByTestId } = renderAppShell()
		await findByTestId("app-sidebar")

		expect(container.querySelector('nav a[href="/documents"]')).not.toBeNull()
	})
})

describe("AppShell module menu", () => {
	it("shows the module view when the slot is claimed", async () => {
		const { findByTestId } = renderAppShell("/documents", { claimSlot: true })
		// The module owns its way back to the main menu (like the documents
		// tree's footer button); the shell renders no trigger of its own.
		await findByTestId("test-show-main-menu")
		const sidebar = await findByTestId("app-sidebar")

		// The tree module brings its own search and appearance settings, so
		// the global search field and the footer stay out of the way.
		expect(
			sidebar.querySelector('[data-testid="global-search-input"]'),
		).toBeNull()
		expect(sidebar.querySelector('a[href="/settings"]')).toBeNull()
		expect(sidebar.querySelector('a[href="/settings/data"]')).toBeNull()
		expect(sidebar.querySelector('a[href="/characters"]')).toBeNull()
		const slot = sidebar.querySelector("[data-sidebar-slot]")
		expect(slot).not.toBeNull()
		expect(slot?.classList.contains("hidden")).toBe(false)
	})

	it("toggles to the main menu and back via the documents row", async () => {
		prefSync.set(prefKeys.docLastOpened, "")

		const { findByTestId } = renderAppShell("/documents", { claimSlot: true })
		const sidebar = await findByTestId("app-sidebar")
		fireEvent.click(await findByTestId("test-show-main-menu"))

		// Main menu view: search, nav and footer return; the slot stays
		// mounted but hidden so the portaled module keeps its state.
		await waitFor(() => {
			expect(
				sidebar.querySelector('[data-testid="global-search-input"]'),
			).not.toBeNull()
		})
		expect(sidebar.querySelector('a[href="/characters"]')).not.toBeNull()
		expect(sidebar.querySelector('a[href="/settings"]')).not.toBeNull()
		const slot = sidebar.querySelector("[data-sidebar-slot]")
		expect(slot).not.toBeNull()
		expect(slot?.classList.contains("hidden")).toBe(true)

		// Clicking Documents while already under /documents returns to the
		// module view.
		const docsRow = sidebar.querySelector('nav a[href="/documents"]')
		if (docsRow === null) throw new Error("documents row not rendered")
		fireEvent.click(docsRow)

		await waitFor(() => {
			expect(
				sidebar.querySelector('[data-testid="global-search-input"]'),
			).toBeNull()
		})
		expect(slot?.classList.contains("hidden")).toBe(false)
	})

	it("returns to the module via the bottom-edge button in the main menu", async () => {
		const { findByTestId } = renderAppShell("/documents", { claimSlot: true })
		const sidebar = await findByTestId("app-sidebar")
		fireEvent.click(await findByTestId("test-show-main-menu"))

		// Main menu view: a bottom-edge button leads back to the module.
		const backToModule = await waitFor(() => {
			const el = sidebar.querySelector('[data-testid="sidebar-show-module"]')
			if (el === null) throw new Error("back-to-module button not rendered")
			return el
		})
		fireEvent.click(backToModule)

		await waitFor(() => {
			expect(
				sidebar.querySelector('[data-testid="global-search-input"]'),
			).toBeNull()
		})
		expect(
			sidebar.querySelector('[data-testid="sidebar-show-module"]'),
		).toBeNull()
	})
})

describe("AppShell sync status", () => {
	it("shows the due state when no device is configured", async () => {
		const { findByText } = renderAppShell()
		await findByText("Sync due")
	})

	it("shows the synced state when every device is up to date", async () => {
		setTrpcClient(
			createMockTrpcClient({
				...baseHandlers,
				"sync.summary": () => ({
					remindDays: 7,
					devices: [
						{
							id: "device-1",
							name: "Backup drive",
							notes: "",
							createdAt: "2026-07-28T00:00:00.000Z",
							updatedAt: "2026-07-28T00:00:00.000Z",
							due: false,
						},
					],
				}),
			}),
		)
		const { findByText } = renderAppShell()
		await findByText("Synced")
	})

	it("shows the due state when a device reminder is pending", async () => {
		setTrpcClient(
			createMockTrpcClient({
				...baseHandlers,
				"sync.summary": () => ({
					remindDays: 7,
					devices: [
						{
							id: "device-1",
							name: "Backup drive",
							notes: "",
							createdAt: "2026-07-28T00:00:00.000Z",
							updatedAt: "2026-07-28T00:00:00.000Z",
							due: true,
							elapsedDays: 10,
						},
					],
				}),
			}),
		)
		const { findByText } = renderAppShell()
		await findByText("Sync due")
	})
})

describe("AppShell storage strip", () => {
	it("renders occupied and remaining as text, plus the top owners once loaded", async () => {
		const { container, findByText } = renderAppShell()
		await findByText("Gallery")
		await findByText("Archived copies")

		expect(container.querySelector('a[href="/settings/data"]')).not.toBeNull()
		// Mock: used 512 B, free 512 B, total 1024 B — total is omitted.
		expect(container.textContent).toContain("Used 512 B")
		expect(container.textContent).toContain("512 B free")
		expect(container.textContent).not.toContain("1 KB")
	})

	it("fills the bar with archive owner segments, not with the volume share", async () => {
		const { findByTestId } = renderAppShell()
		const bar = await findByTestId("sidebar-storage-bar")

		// The strip is scoped to hoardodile's own bytes: one segment per
		// non-zero owner fills the whole bar. The previous volume-share
		// meter wrapped them in a single used-ratio track.
		expect(bar.children).toHaveLength(8)
		const firstSegment = bar.children.item(0)
		if (!(firstSegment instanceof HTMLElement)) {
			throw new Error("storage segment missing")
		}
		expect(firstSegment.style.backgroundColor).not.toBe("")
	})
})

describe("AppShell desktop caption", () => {
	const defaultMatchMedia = window.matchMedia

	afterEach(() => {
		Reflect.deleteProperty(window, "hoardodileDesktop")
		window.matchMedia = defaultMatchMedia
	})

	it("sits on the content column, spanning canvas and panel, not the sidebar", async () => {
		installDesktopBridge()
		const { findByTestId } = renderAppShell("/", { claimPanel: true })
		const caption = await findByTestId("desktop-caption-bar")
		const sidebar = await findByTestId("app-sidebar")
		const panel = await findByTestId("app-filter-panel")

		expect(sidebar.contains(caption)).toBe(false)
		expect(caption.parentElement?.contains(sidebar)).toBe(false)
		expect(caption.parentElement?.contains(panel)).toBe(true)
	})

	it("is full-width on login, with no sidebar", async () => {
		installDesktopBridge()
		const { findByTestId, queryByTestId } = renderAppShell("/login")
		await findByTestId("desktop-caption-bar")
		expect(queryByTestId("app-sidebar")).toBeNull()
	})

	it("hosts the global sidebar toggle leftmost in the strip below the sidebar breakpoint", async () => {
		installDesktopBridge()
		window.matchMedia = makeMatchMedia({ [SIDEBAR_QUERY]: true })
		const { findByTestId } = renderAppShell("/")
		const caption = await findByTestId("desktop-caption-bar")
		const toggle = await findByTestId("app-sidebar-open")
		const back = await findByTestId("desktop-caption-back")

		expect(caption.contains(toggle)).toBe(true)
		expect(
			toggle.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
	})

	it("opens the drawer from the caption-strip toggle", async () => {
		installDesktopBridge()
		window.matchMedia = makeMatchMedia({ [SIDEBAR_QUERY]: true })
		const user = userEvent.setup()
		const { container, findByTestId } = renderAppShell("/")
		const toggle = await findByTestId("app-sidebar-open")

		// Only the hidden desktop sidebar (not the drawer) is mounted.
		expect(container.querySelectorAll('img[src="/logo.png"]')).toHaveLength(1)
		await user.click(toggle)
		// The drawer instance mounts its own sidebar content.
		expect(container.querySelectorAll('img[src="/logo.png"]')).toHaveLength(2)
	})

	it("renders no sidebar toggle at and above the sidebar breakpoint", async () => {
		installDesktopBridge()
		const { findByTestId, queryByTestId } = renderAppShell("/")
		await findByTestId("desktop-caption-bar")
		expect(queryByTestId("app-sidebar-open")).toBeNull()
	})

	it("keeps the drawer hamburger in the top row in a browser tab", async () => {
		const { findByTestId } = renderAppShell("/")
		const toggle = await findByTestId("app-sidebar-open")

		expect(toggle.closest('[data-testid="desktop-caption-bar"]')).toBeNull()
	})
})

/**
 * matchMedia stub where each query matches per `matchesByQuery`, mirroring
 * the default stub's shape so media-query hooks get a deterministic answer.
 */
function makeMatchMedia(matchesByQuery: Record<string, boolean>) {
	return ((query: string) => ({
		matches: matchesByQuery[query] === true,
		media: query,
		onchange: null,
		addListener: () => undefined,
		removeListener: () => undefined,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		dispatchEvent: () => false,
	})) as typeof window.matchMedia
}

function installDesktopBridge() {
	const bridge: HoardodileDesktopBridge = {
		isDesktop: true,
		platform: "desktop",
		minimize() {},
		toggleMaximize() {},
		close() {},
		retryLoad() {},
		async isMaximized() {
			return false
		},
		onMaximizedChange() {
			return () => undefined
		},
		updates: {
			portable: false,
			async status() {
				return { status: "idle" }
			},
			onStatus() {
				return () => undefined
			},
			async check() {},
			async quitAndInstall() {},
		},
		async pickLibraryFolder() {
			return undefined
		},
		async relaunch() {},
		async getConfig() {
			return {
				libraryPath: "",
				sharedFolderRoot: "",
				sharedFolderEnabled: false,
				port: 3000,
				lanEnabled: false,
				autoStart: false,
				startInTray: false,
				closeAction: "ask",
				autoUpdate: false,
				portable: false,
			}
		},
		async setConfig() {},
		async setCloseAction() {},
		async closeWithAction() {},
		setLanguage() {},
		async getLanguage() {
			return "en"
		},
		async changeLibraryFolder() {},
		async setSharedFolderRoot() {},
		async setSharedFolderEnabled() {},
		async getLanInfo() {
			return { enabled: false, port: 3000, preferredPort: 3000, addresses: [] }
		},
		async setLanEnabled() {},
		async setLanPort() {},
		async getShellCacheSize() {
			return 0
		},
		async clearShellCache() {
			return 0
		},
		async completeWizard() {},
		async getWizardDefaults() {
			return { libraryPath: "" }
		},
		openExternal() {},
		registerAppRoutes() {},
	}
	window.hoardodileDesktop = bridge
}
