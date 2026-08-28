import { QueryClient } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { handleSseEvent } from "@/routes/__root"
import {
	getDownloadConsentSnapshot,
	resetDownloadConsent,
} from "./consent-store"
import { DownloadConsentDialog } from "./DownloadConsentDialog"

const decideMock = vi.fn()

vi.mock("@/trpc/factory", () => ({
	trpcMutate: (...args: unknown[]) => decideMock(...args),
}))
vi.mock("@/lib/client-reset", () => ({
	hardResetAndReload: vi.fn(),
}))

const REQUESTED = {
	type: "pluginDownloadRequested" as const,
	ticketId: "t-flow",
	pluginId: "p-1",
	pluginName: "Live2D Viewer",
	items: [
		{
			url: "https://example.com/runtime/live2d.min.js",
			dest: "runtime/live2d.min.js",
		},
	],
}

const queryClient = () =>
	new QueryClient({ defaultOptions: { queries: { retry: false } } })

beforeEach(() => {
	resetDownloadConsent()
	decideMock.mockReset()
	decideMock.mockResolvedValue(undefined)
})

describe("plugin download consent flow (SSE → dialog → decision)", () => {
	it("shows the dialog on the request event and closes it on deny", async () => {
		render(<DownloadConsentDialog />)
		await handleSseEvent(queryClient(), REQUESTED)

		expect(getDownloadConsentSnapshot().queue).toHaveLength(1)
		const content = await screen.findByTestId("plugin-download-consent")
		// The dialog must stay above the plugin preview window layer.
		expect(content).toHaveClass("z-[70]")

		await userEvent.click(screen.getByTestId("plugin-download-deny"))
		await waitFor(() => {
			expect(decideMock).toHaveBeenCalledWith("pluginAsset", "decide", {
				ticketId: "t-flow",
				approved: false,
				remember: false,
			})
		})
		await waitFor(() => {
			expect(getDownloadConsentSnapshot().queue).toEqual([])
		})
	})

	it("closes the entry on the resolution broadcast (timeout/other tab)", async () => {
		render(<DownloadConsentDialog />)
		await handleSseEvent(queryClient(), REQUESTED)
		await screen.findByTestId("plugin-download-consent")

		await handleSseEvent(queryClient(), {
			type: "pluginDownloadResolved",
			ticketId: "t-flow",
		})
		expect(getDownloadConsentSnapshot().queue).toEqual([])
	})

	it("a denied first ticket never blocks the queued next one", async () => {
		render(<DownloadConsentDialog />)
		await handleSseEvent(queryClient(), REQUESTED)
		await handleSseEvent(queryClient(), {
			...REQUESTED,
			ticketId: "t-flow-2",
		})
		expect(getDownloadConsentSnapshot().queue.map((e) => e.ticketId)).toEqual([
			"t-flow",
			"t-flow-2",
		])

		await userEvent.click(await screen.findByTestId("plugin-download-deny"))
		await waitFor(() => {
			expect(getDownloadConsentSnapshot().queue.map((e) => e.ticketId)).toEqual(
				["t-flow-2"],
			)
		})
		// The next ticket is presented, not stuck behind the closed one.
		expect(screen.getAllByTestId("plugin-download-url")).toHaveLength(1)
	})
})
