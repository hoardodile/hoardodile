import "./style.css"
import { createInMemoryFileBackend, createMockHost } from "@hoardodile/host-web"
import type { PluginIframeContext } from "@hoardodile/sdk-web"
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { MobileBackProvider } from "@hoardodile/ui/hooks/useMobileBackToClose"
import { getMobileBackController } from "@hoardodile/ui/lib/mobile-back-browser"
import {
	createRootRoute,
	createRoute,
	createRouter,
	Link,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { StrictMode, useEffect, useState } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { useDocLeaveGuard } from "../../src/features/doc/hooks/useDocLeaveGuard"
import { createMobileBackHistory } from "../../src/lib/mobile-back-history"

const controller = getMobileBackController()
const history = createMobileBackHistory(controller)
let loads = 0

function Frame() {
	const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
	const [hidden, setHidden] = useState(false)
	useEffect(() => {
		if (frame === null) return
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend(),
			overlays: controller,
		})
		function mount() {
			const source = frame?.contentWindow
			if (source == null) return
			host.register(source, { pluginId: "fixture", resId: "resource" })
			host.pushContext(source, {
				pluginId: "fixture",
				resId: "resource",
				resName: "Fixture",
				sourceMeta: undefined,
				searchMeta: undefined,
				fileStats: undefined,
				contentPluginId: "fixture",
				language: "en",
				resolvedTheme: "light",
				palette: "mono",
				iconStyle: "duotone",
				fonts: { family: "", cssPaths: [] },
				initialPrefs: {},
				initialCache: {},
				fileToken: "",
				assetToken: "",
			} satisfies PluginIframeContext)
		}
		frame.addEventListener("load", mount)
		return () => {
			frame.removeEventListener("load", mount)
			host.dispose()
		}
	}, [frame])
	return (
		<>
			<button type="button" onClick={() => setHidden(!hidden)}>
				Toggle frame visibility
			</button>
			<iframe
				ref={setFrame}
				title="Plugin"
				src="/frame.html"
				sandbox="allow-scripts allow-forms allow-downloads"
				style={{
					width: 360,
					height: 250,
					visibility: hidden ? "hidden" : "visible",
				}}
			/>
		</>
	)
}

function Page() {
	const [parent, setParent] = useState(false)
	const [child, setChild] = useState(false)
	const [menu, setMenu] = useState(false)
	const [frame, setFrame] = useState(false)
	const [dirty, setDirty] = useState(false)
	useDocLeaveGuard({ dirty, message: "Leave fixture?" })
	return (
		<>
			<h1>History fixture</h1>
			<Link to="/one">One</Link> <Link to="/two">Two</Link>
			<button
				type="button"
				onClick={() => {
					setParent(true)
					setChild(true)
				}}
			>
				Open nested
			</button>
			<button type="button" onClick={() => setParent(true)}>
				Open parent
			</button>
			<button type="button" onClick={() => setDirty(!dirty)}>
				Toggle dirty
			</button>
			<button type="button" onClick={() => setFrame(!frame)}>
				Toggle frame
			</button>
			<output data-testid="parent">{String(parent)}</output>
			<output data-testid="child">{String(child)}</output>
			<output data-testid="dirty">{String(dirty)}</output>
			<output data-testid="loads">{loads}</output>
			<DropdownMenu open={menu} onOpenChange={setMenu}>
				<DropdownMenuTrigger>Menu</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem onClick={() => setParent(true)}>
						Open from menu
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{frame && <Frame />}
			<Dialog open={parent} onOpenChange={setParent}>
				<DialogContent>
					<DialogTitle>Parent</DialogTitle>
					<button type="button" onClick={() => setParent(false)}>
						Close parent
					</button>
					<button
						type="button"
						onClick={() => {
							flushSync(() => setParent(false))
							queueMicrotask(() => setParent(true))
						}}
					>
						Close and reopen
					</button>
					<button type="button" onClick={() => setChild(true)}>
						Open child
					</button>
					<button type="button" onClick={() => history.replace("/two")}>
						Replace route
					</button>
					<button type="button" onClick={() => history.push("/two")}>
						Push route
					</button>
					<Dialog open={child} onOpenChange={setChild}>
						<DialogContent>
							<DialogTitle>Child</DialogTitle>
							<button type="button" onClick={() => setChild(false)}>
								Close child
							</button>
						</DialogContent>
					</Dialog>
				</DialogContent>
			</Dialog>
		</>
	)
}
const root = createRootRoute({ component: Outlet })
const routes = ["/", "/one", "/two"].map((path) =>
	createRoute({
		getParentRoute: () => root,
		path,
		component: Page,
		loader: () => {
			loads++
		},
	}),
)
const router = createRouter({
	history,
	routeTree: root.addChildren(routes),
	defaultPendingMs: 0,
})
createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<MobileBackProvider registry={controller}>
			<RouterProvider router={router} />
		</MobileBackProvider>
	</StrictMode>,
)
Object.assign(window, {
	mobileBackFixture: {
		controller,
		history,
		router,
		getState: () => ({
			...controller.snapshot,
			route: router.state.location.href,
			loads,
		}),
	},
})
