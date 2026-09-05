import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { RouterContext } from "@/routes/__root"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { FolderImporter } from "./FolderImporter"

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
								mutate: async (input: unknown) => {
									const key = `${namespace}.${procedure}`
									const handler = handlers[key]
									if (handler) return handler(input)
									return undefined
								},
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

const defaultHandlers: Record<string, (input: unknown) => unknown> = {
	"resource.importConfig": () => ({ sharedFolderRoot: "/storage/import" }),
	"resource.browseDirectory": () => ({
		entries: [
			{ name: "manga", kind: "dir" },
			{ name: "readme.txt", kind: "file" },
		],
	}),
	"resource.folderScan": () => [
		{
			name: "chapter-1",
			path: "/storage/import/manga/chapter-1",
			kind: "dir",
			contentPluginId: "11111111-1111-4111-8111-111111111111",
			pluginName: "Manga",
		},
		{
			name: "cover.jpg",
			path: "/storage/import/manga/cover.jpg",
			kind: "file",
			contentPluginId: "22222222-2222-4222-8222-222222222222",
			pluginName: "Gallery",
		},
	],
	"resource.folderImport": () => ({
		scanned: 2,
		imported: 2,
		failed: 0,
		warnings: [],
	}),
}

let originalClient: TRPCClient

beforeAll(() => {
	originalClient = createMockTrpcClient(defaultHandlers)
	setTrpcClient(originalClient)
})

beforeEach(() => {
	setTrpcClient(originalClient)
})

function createRouterWith(element: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})

	const testContext: RouterContext = {
		queryClient,
		trpc: {} as RouterContext["trpc"],
	}

	const rootRoute = createRootRouteWithContext<RouterContext>()({
		component: () => <Outlet />,
	})

	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => element,
	})

	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		context: testContext,
		history: createMemoryHistory({ initialEntries: ["/"] }),
		defaultPendingMs: 0,
	})

	return { router, queryClient }
}

async function renderImporter() {
	const { router, queryClient } = createRouterWith(<FolderImporter />)

	await act(async () => {
		await router.load()
	})

	let utils!: ReturnType<typeof render>
	await act(async () => {
		utils = render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		)
	})
	return utils
}

describe("FolderImporter", () => {
	it("renders source selection with server folder and zip options", async () => {
		await renderImporter()

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})

		expect(screen.getByTestId("folder-source-zip")).toBeInTheDocument()
		expect(screen.getByText("Browse shared folders")).toBeInTheDocument()
		expect(screen.getByText("Choose an archive")).toBeInTheDocument()
		// The picker mirrors every archive format the server sniffs
		// (zip/tar/7z/rar/xz/gzip) — see plugins/host/src/archive/format.ts.
		const fileInput =
			document.querySelector<HTMLInputElement>('input[type="file"]')
		expect(fileInput?.accept).toContain(".zip")
		expect(fileInput?.accept).toContain(".7z")
		expect(fileInput?.accept).toContain(".rar")
		expect(fileInput?.accept).toContain(".tar.gz")
		expect(fileInput?.accept).toContain("application/x-7z-compressed")
	})

	it("disables shared folder option when not configured", async () => {
		setTrpcClient(
			createMockTrpcClient({
				...defaultHandlers,
				"resource.importConfig": () => ({ sharedFolderRoot: undefined }),
			}),
		)
		await renderImporter()

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})

		const browseButton = screen.getByTestId("folder-source-shared")
		expect(browseButton).toBeDisabled()
		expect(
			screen.getByText("Shared folder import is not configured."),
		).toBeInTheDocument()
		expect(screen.getByTestId("folder-source-zip")).toBeInTheDocument()
	})

	it("advances to browse step when selecting server folder", async () => {
		const user = userEvent.setup()
		await renderImporter()

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeEnabled()
		})

		await user.click(screen.getByTestId("folder-source-shared"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-browse-section")).toBeInTheDocument()
		})

		await waitFor(() => {
			expect(screen.getAllByTestId("folder-dir-item").length).toBe(1)
		})
		expect(screen.getByText("manga")).toBeInTheDocument()
		expect(screen.getByText("readme.txt")).toBeInTheDocument()
	})

	it("navigates deeper into folders and updates breadcrumb", async () => {
		const user = userEvent.setup()
		setTrpcClient(
			createMockTrpcClient({
				...defaultHandlers,
				"resource.browseDirectory": (input: unknown) => {
					const { subPath } = input as { subPath?: string }
					if (subPath === "manga") {
						return {
							entries: [{ name: "chapter-1", kind: "dir" }],
						}
					}
					return {
						entries: [
							{ name: "manga", kind: "dir" },
							{ name: "readme.txt", kind: "file" },
						],
					}
				},
			}),
		)
		await renderImporter()

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeEnabled()
		})

		await user.click(screen.getByTestId("folder-source-shared"))

		await waitFor(() => {
			expect(screen.getAllByTestId("folder-dir-item").length).toBe(1)
		})

		await user.click(screen.getByText("manga"))

		await waitFor(() => {
			expect(screen.getByText("chapter-1")).toBeInTheDocument()
		})
		expect(
			screen.getByRole("button", { name: "Shared root" }),
		).toBeInTheDocument()
	})

	it("advances to preview step and shows scanned entries", async () => {
		const user = userEvent.setup()
		await renderImporter()

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeEnabled()
		})

		await user.click(screen.getByTestId("folder-source-shared"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-browse-section")).toBeInTheDocument()
		})

		await user.click(screen.getByTestId("folder-scan-here"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-preview-section")).toBeInTheDocument()
		})

		expect(screen.getByText("chapter-1")).toBeInTheDocument()
		expect(screen.getByText("cover.jpg")).toBeInTheDocument()
		expect(screen.getByText("Manga")).toBeInTheDocument()
		expect(screen.getByText("Gallery")).toBeInTheDocument()
	})

	it("runs import and renders result badges", async () => {
		const user = userEvent.setup()
		await renderImporter()

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeEnabled()
		})

		await user.click(screen.getByTestId("folder-source-shared"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-browse-section")).toBeInTheDocument()
		})

		await user.click(screen.getByTestId("folder-scan-here"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-preview-section")).toBeInTheDocument()
		})

		await user.click(screen.getByTestId("folder-confirm-import"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-result-section")).toBeInTheDocument()
		})

		expect(screen.getByText("Scanned: 2")).toBeInTheDocument()
		expect(screen.getByText("Imported: 2")).toBeInTheDocument()
	})

	it("returns to source step when clicking back from browse", async () => {
		const user = userEvent.setup()
		await renderImporter()

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeEnabled()
		})

		await user.click(screen.getByTestId("folder-source-shared"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-browse-section")).toBeInTheDocument()
		})

		await user.click(screen.getByText("Back"))

		await waitFor(() => {
			expect(screen.getByTestId("folder-source-shared")).toBeInTheDocument()
		})
	})
})
