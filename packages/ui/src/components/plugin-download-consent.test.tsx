import { cleanup, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderWithI18n, testI18n } from "../test/i18n"
import {
	PluginDownloadConsentDialog,
	type PluginConsentTicket,
} from "./plugin-download-consent"

const TICKET: PluginConsentTicket = {
	ticketId: "t-1",
	pluginId: "p-1",
	pluginName: "Gallery",
	url: "https://example.com/runtime/live2d.min.js?x=1",
	dest: "runtime/live2d.min.js",
	sizeBytes: 2048,
	reason: "live2d runtime",
}

afterEach(() => {
	cleanup()
	void testI18n.changeLanguage("en")
})

function renderDialog(
	overrides: Partial<Parameters<typeof PluginDownloadConsentDialog>[0]> = {},
) {
	const onDeny = vi.fn()
	const onAllow = vi.fn()
	renderWithI18n(
		<PluginDownloadConsentDialog
			entry={TICKET}
			onDeny={onDeny}
			onAllow={onAllow}
			formatBytes={(n) => `${n} B`}
			{...overrides}
		/>,
	)
	return { onDeny, onAllow }
}

describe("PluginDownloadConsentDialog", () => {
	it("shows the URL verbatim, destination and plugin reason", async () => {
		renderDialog()
		// Base UI mounts the dialog portal on effects; wait for the first
		// assertion instead of querying the pre-mount tree.
		expect(await screen.findByTestId("plugin-download-url")).toHaveTextContent(
			"https://example.com/runtime/live2d.min.js?x=1",
		)
		expect(screen.getByTestId("plugin-download-dest")).toHaveTextContent(
			"runtime/live2d.min.js",
		)
		expect(screen.getByText("live2d runtime")).toBeInTheDocument()
		expect(screen.getByText(/2048 B/)).toBeInTheDocument()
		expect(screen.getByTestId("plugin-download-deny")).toHaveTextContent("Deny")
		expect(screen.getByTestId("plugin-download-allow")).toHaveTextContent("Allow")
	})

	it("Deny reports the ticket id", async () => {
		const { onDeny } = renderDialog()
		await userEvent.click(screen.getByTestId("plugin-download-deny"))
		expect(onDeny).toHaveBeenCalledWith("t-1")
	})

	it("Allow reports the ticket id with the remember flag", async () => {
		const { onAllow } = renderDialog()
		await userEvent.click(screen.getByTestId("plugin-download-allow"))
		expect(onAllow).toHaveBeenCalledWith("t-1", false)
		await userEvent.click(screen.getByRole("checkbox"))
		await userEvent.click(screen.getByTestId("plugin-download-allow"))
		expect(onAllow).toHaveBeenLastCalledWith("t-1", true)
	})

	it("renders nothing actionable when no ticket is queued", () => {
		renderDialog({ entry: null })
		expect(
			screen.queryByTestId("plugin-download-allow"),
		).not.toBeInTheDocument()
	})

	it("follows the host language via the ui catalog", async () => {
		await testI18n.changeLanguage("zh")
		renderDialog()
		// Base UI mounts the dialog portal on effects; wait for the first
		// assertion instead of querying the pre-mount tree.
		expect(
			await screen.findByRole("button", { name: "允许" }),
		).toBeInTheDocument()
	})
})
