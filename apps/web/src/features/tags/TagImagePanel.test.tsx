import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { TagImagePanel } from "./TagImagePanel"

const TAG_ID = "tag-1"

function createMockTrpcClient(): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, _namespace: string) {
				return new Proxy(
					{},
					{
						get(_, _procedure: string) {
							return {
								query: async () => undefined,
								mutate: async () => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

function stubBlobUrls() {
	const create = vi.fn(() => "blob:tag-art")
	const revoke = vi.fn()
	Object.defineProperty(URL, "createObjectURL", {
		writable: true,
		configurable: true,
		value: create,
	})
	Object.defineProperty(URL, "revokeObjectURL", {
		writable: true,
		configurable: true,
		value: revoke,
	})
	return { create, revoke }
}

function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<AppDialog
				open
				title="Edit image"
				onOpenChange={() => {}}
				footer={
					<button type="button" data-testid="close-btn">
						Close
					</button>
				}
			>
				<TagImagePanel tagId={TAG_ID} onSaved={() => {}} />
			</AppDialog>
		</QueryClientProvider>,
	)
}

describe("TagImagePanel", () => {
	beforeEach(() => {
		setTrpcClient(createMockTrpcClient())
		stubBlobUrls()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("shows the danger Remove button when the tag already has art (preload 200)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(new Blob(["art"]), { status: 200 })),
		)
		renderPanel()
		expect(
			await screen.findByTestId(`tag-image-remove-${TAG_ID}`),
		).toBeInTheDocument()
	})

	it("hides the Remove button when the tag has no art (preload 404)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("no image", { status: 404 })),
		)
		renderPanel()
		await waitFor(() => {
			expect(
				screen.queryByTestId(`tag-image-remove-${TAG_ID}`),
			).not.toBeInTheDocument()
		})
	})
})
