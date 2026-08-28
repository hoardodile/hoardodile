import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	enqueueDownloadConsent,
	getDownloadConsentSnapshot,
	resetDownloadConsent,
} from "./consent-store"
import { DownloadConsentDialog } from "./DownloadConsentDialog"

const decideMock = vi.fn()

vi.mock("@/trpc/factory", () => ({
	trpcMutate: (...args: unknown[]) => decideMock(...args),
}))

function enqueueTicket(): void {
	enqueueDownloadConsent({
		ticketId: "t-1",
		pluginId: "p-1",
		pluginName: "Live2D Viewer",
		items: [
			{ url: "https://example.com/runtime.mjs", dest: "runtime/runtime.mjs" },
		],
	})
}

beforeEach(() => {
	resetDownloadConsent()
	decideMock.mockReset()
})

describe("DownloadConsentDialog", () => {
	it("deny closes the entry locally after the server decides", async () => {
		enqueueTicket()
		decideMock.mockResolvedValue(undefined)
		render(<DownloadConsentDialog />)

		await userEvent.click(await screen.findByTestId("plugin-download-deny"))
		await waitFor(() => {
			expect(decideMock).toHaveBeenCalledWith("pluginAsset", "decide", {
				ticketId: "t-1",
				approved: false,
				remember: false,
			})
		})
		await waitFor(() => {
			expect(getDownloadConsentSnapshot().queue).toEqual([])
		})
	})

	it("allow closes the entry locally after the server decides", async () => {
		enqueueTicket()
		decideMock.mockResolvedValue(undefined)
		render(<DownloadConsentDialog />)

		await userEvent.click(await screen.findByTestId("plugin-download-allow"))
		await waitFor(() => {
			expect(decideMock).toHaveBeenCalledWith("pluginAsset", "decide", {
				ticketId: "t-1",
				approved: true,
				remember: false,
			})
		})
		await waitFor(() => {
			expect(getDownloadConsentSnapshot().queue).toEqual([])
		})
	})

	it("keeps the entry queued when the decide mutation fails", async () => {
		enqueueTicket()
		decideMock.mockRejectedValue(new Error("offline"))
		render(<DownloadConsentDialog />)

		await userEvent.click(await screen.findByTestId("plugin-download-deny"))
		await waitFor(() => expect(decideMock).toHaveBeenCalled())
		expect(getDownloadConsentSnapshot().queue).toHaveLength(1)
	})

	it("a retry deny after a failed decide closes the entry", async () => {
		enqueueTicket()
		decideMock.mockRejectedValueOnce(new Error("offline"))
		decideMock.mockResolvedValueOnce(undefined)
		render(<DownloadConsentDialog />)

		await userEvent.click(await screen.findByTestId("plugin-download-deny"))
		await waitFor(() => expect(decideMock).toHaveBeenCalledTimes(1))
		expect(getDownloadConsentSnapshot().queue).toHaveLength(1)

		await userEvent.click(screen.getByTestId("plugin-download-deny"))
		await waitFor(() => expect(decideMock).toHaveBeenCalledTimes(2))
		await waitFor(() => {
			expect(getDownloadConsentSnapshot().queue).toEqual([])
		})
	})

	it("stays raised above the plugin preview pool layer", async () => {
		enqueueTicket()
		decideMock.mockResolvedValue(undefined)
		render(<DownloadConsentDialog />)

		const content = await screen.findByTestId("plugin-download-consent")
		expect(content).toHaveClass("z-[70]")
	})
})
