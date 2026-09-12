import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import {
	type RouterOutputs,
	setTrpcClient,
	type TRPCClient,
} from "@/trpc/client"
import { ArchivePageActions } from "./ArchivePageActions"
import { DataHistoryPanel } from "./DataHistoryPanel"

vi.mock("@/features/settings/datePrefs", () => ({
	useDateFormatter: () => ({
		formatDateTime: (time: number) => new Date(time).toISOString(),
	}),
}))
vi.mock("@/lib/client-reset", () => ({ hardResetAndReload: vi.fn() }))
const clients: QueryClient[] = []
beforeAll(async () => {
	await i18n.changeLanguage("en")
})
afterEach(() => {
	for (const client of clients.splice(0)) client.clear()
})

/** The archives page: page actions above, panel below. `readOnly` =
    viewing a past archive (active = v1). */
function setup(readOnly = false) {
	const versions: RouterOutputs["version"]["list"] = [
		{
			version: 1,
			current: false,
			active: readOnly,
			dbSize: 100,
			name: "Past",
			note: "Frozen note",
		},
		{
			version: 2,
			current: true,
			active: !readOnly,
			dbSize: 200,
			name: "Current",
		},
	]
	const select = vi.fn(async () => ({ version: 1, willRestart: false }))
	const metadata = vi.fn(async () => undefined)
	const create = vi.fn(async () => ({ id: "archive-job", state: "queued" }))
	setTrpcClient({
		version: {
			list: { query: async () => versions },
			switchTo: { mutate: select },
			updateMeta: { mutate: metadata },
		},
		protection: { archive: { mutate: create } },
	} as unknown as TRPCClient)
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	clients.push(client)
	render(
		<QueryClientProvider client={client}>
			<ArchivePageActions />
			<DataHistoryPanel />
		</QueryClientProvider>,
	)
	return { select, metadata, create, user: userEvent.setup() }
}

it("lists archives newest first as cards and switches only after confirmation", async () => {
	const { user, select } = setup()
	const current = await screen.findByTestId("archive-2")
	const past = screen.getByTestId("archive-1")
	// Both versions render as cards of the one grid, newest first.
	const grid = screen.getByTestId("data-history-cards")
	expect(grid).toContainElement(current)
	expect(grid).toContainElement(past)
	expect(
		current.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy()
	// The writable current version wears the "Latest" top banner (the
	// marketplace's installed strip), the historical one the read-only chip,
	// and the note sits under the title.
	expect(screen.getByTestId("archive-latest-banner-2")).toHaveTextContent(
		"Latest",
	)
	expect(
		screen.queryByTestId("archive-latest-banner-1"),
	).not.toBeInTheDocument()
	expect(past).toHaveTextContent("Read-only")
	expect(past).toHaveTextContent("Frozen note")
	await user.click(screen.getByTestId("switch-1"))
	expect(select).not.toHaveBeenCalled()
	await user.click(screen.getByTestId("switch-confirm-submit"))
	await waitFor(() => expect(select).toHaveBeenCalledWith({ version: 1 }))
})

it("edits only the current version while others offer the switch button", async () => {
	const { user, metadata } = setup()
	await screen.findByTestId("archive-2")
	expect(screen.getByTestId("edit-2")).toBeInTheDocument()
	expect(screen.queryByTestId("edit-1")).not.toBeInTheDocument()
	expect(screen.getByTestId("switch-1")).toBeInTheDocument()
	expect(screen.queryByTestId("switch-2")).not.toBeInTheDocument()

	await user.click(screen.getByTestId("edit-2"))
	const dialog = screen.getByTestId("archive-meta-dialog")
	const name = screen.getByLabelText("Name")
	expect(name).toHaveValue("Current")
	await user.clear(name)
	await user.type(name, "Renamed")
	await user.clear(screen.getByLabelText("Note"))
	await user.click(screen.getByTestId("archive-meta-save"))
	await waitFor(() =>
		expect(metadata).toHaveBeenCalledWith({
			version: 2,
			name: "Renamed",
			note: "",
		}),
	)
	expect(dialog).not.toBeInTheDocument()
})

it("disables creation and edits while viewing history, offering switch back", async () => {
	const { user, metadata } = setup(true)
	const viewed = await screen.findByTestId("archive-1")
	// The viewed archive is marked on its card.
	expect(viewed).toHaveTextContent("Viewing")
	expect(screen.getByTestId("create-archive")).toBeDisabled()
	// The viewed (active) version offers nothing; the current version is
	// the way back and carries no edit button in read-only mode.
	expect(screen.queryByTestId("switch-1")).not.toBeInTheDocument()
	expect(screen.queryByTestId("edit-2")).not.toBeInTheDocument()
	expect(screen.getByTestId("switch-2")).toBeInTheDocument()
	await user.click(screen.getByTestId("switch-2"))
	await user.click(screen.getByTestId("switch-confirm-submit"))
	await waitFor(() => expect(metadata).not.toHaveBeenCalled())
})

it("saves a current archive name and note through the edit dialog", async () => {
	const { user, metadata } = setup()
	await screen.findByTestId("archive-2")
	await user.click(screen.getByTestId("edit-2"))
	await user.type(screen.getByLabelText("Name"), " Milestone")
	await user.type(screen.getByLabelText("Note"), "Before release")
	await user.click(screen.getByTestId("archive-meta-save"))
	await waitFor(() =>
		expect(metadata).toHaveBeenCalledWith({
			version: 2,
			name: "Current Milestone",
			note: "Before release",
		}),
	)
})

it("starts archive publication after the typed confirmation, without a note field", async () => {
	const { user, create } = setup()
	await user.click(await screen.findByTestId("create-archive"))
	expect(screen.getByTestId("archive-confirm-submit")).toBeDisabled()
	// The shared type-to-confirm prompt renders the phrase in bold inside
	// one line («Type "archive" to confirm») — no literal `<name>` tag.
	const phrase = screen.getByText("archive")
	expect(phrase.parentElement?.textContent).toBe('Type "archive" to confirm')
	expect(screen.queryByText(/<name>/)).not.toBeInTheDocument()
	expect(screen.queryByTestId("archive-note-input")).not.toBeInTheDocument()
	await user.type(screen.getByTestId("archive-confirm-input"), "archive")
	await user.click(screen.getByTestId("archive-confirm-submit"))
	await waitFor(() => expect(create).toHaveBeenCalledWith({}))
})
