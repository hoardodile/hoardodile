import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, expect, it, vi } from "vitest"
import { i18n } from "@/i18n"
import {
	type RouterOutputs,
	setTrpcClient,
	type TRPCClient,
} from "@/trpc/client"
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
			<DataHistoryPanel />
		</QueryClientProvider>,
	)
	return { select, metadata, create, user: userEvent.setup() }
}

it("lists archives newest first and switches only after confirmation", async () => {
	const { user, select } = setup()
	const current = await screen.findByTestId("archive-2")
	const past = screen.getByTestId("archive-1")
	expect(
		current.compareDocumentPosition(past) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy()
	await user.click(past)
	expect(screen.getByText("Frozen note")).toBeInTheDocument()
	expect(screen.queryByTestId("name-preview")).not.toBeInTheDocument()
	await user.click(screen.getByTestId("switch-1"))
	expect(select).not.toHaveBeenCalled()
	await user.click(screen.getByTestId("switch-confirm-submit"))
	await waitFor(() => expect(select).toHaveBeenCalledWith({ version: 1 }))
})

it("edits current metadata but disables creation and editing while viewing history", async () => {
	const { user, metadata } = setup(true)
	await user.click(await screen.findByTestId("archive-2"))
	expect(screen.getByTestId("create-archive")).toBeDisabled()
	expect(screen.queryByTestId("name-preview")).not.toBeInTheDocument()
	expect(metadata).not.toHaveBeenCalled()
})

it("saves a current archive name through the archive API", async () => {
	const { user, metadata } = setup()
	await user.click(await screen.findByTestId("archive-2"))
	await user.click(screen.getByTestId("name-preview"))
	const input = screen.getByTestId("name-input")
	await user.clear(input)
	await user.type(input, "Renamed{Enter}")
	await waitFor(() =>
		expect(metadata).toHaveBeenCalledWith({ version: 2, name: "Renamed" }),
	)
})

it("starts archive publication as a job after the typed confirmation", async () => {
	const { user, create } = setup()
	await screen.findByTestId("archive-2")
	await user.click(screen.getByTestId("create-archive"))
	const dialog = screen.getByRole("dialog")
	expect(within(dialog).getByTestId("archive-confirm-submit")).toBeDisabled()
	await user.type(
		within(dialog).getByTestId("archive-confirm-input"),
		"archive",
	)
	await user.type(within(dialog).getByTestId("archive-note-input"), "Milestone")
	await user.click(within(dialog).getByTestId("archive-confirm-submit"))
	await waitFor(() =>
		expect(create).toHaveBeenCalledWith({ note: "Milestone" }),
	)
})
