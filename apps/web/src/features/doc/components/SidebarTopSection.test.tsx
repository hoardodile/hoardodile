import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	SidebarTopSection,
	type SidebarTopSectionProps,
} from "./SidebarTopSection"

const mockCreate = vi.fn(() =>
	Promise.resolve({ kind: "document", id: "doc-1" }),
)

vi.mock("@/features/doc", () => ({
	createDocumentNodeMutation: () => ({ mutationFn: mockCreate }),
	invalidateDocuments: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/features/doc/hooks/useDocPrefs", () => ({
	useDocTheme: () => ({
		theme: "parchment",
		themeClass: undefined,
		setTheme: vi.fn(),
	}),
}))

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(() => Promise.resolve()),
}))

function Wrapper(props: { readonly children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	})
	return <QueryClientProvider client={qc}>{props.children}</QueryClientProvider>
}

function Harness(props: Partial<SidebarTopSectionProps>) {
	const [search, setSearch] = useState("")
	return (
		<Wrapper>
			<SidebarTopSection
				count={2}
				searchValue={search}
				onSearchChange={setSearch}
				charIds={[]}
				resIds={[]}
				onOpenFilter={vi.fn()}
				trashMode={false}
				onToggleTrash={vi.fn()}
				editMode={false}
				onEditModeChange={vi.fn()}
				readingView={false}
				onToggleReadingView={vi.fn()}
				onOpenAppearanceSettings={vi.fn()}
				{...props}
			/>
		</Wrapper>
	)
}

describe("SidebarTopSection", () => {
	beforeEach(() => {
		mockCreate.mockClear()
	})

	it("forwards the debounced search commit to onSearchChange", async () => {
		const user = userEvent.setup()
		const onSearchChange = vi.fn()
		render(<Harness onSearchChange={onSearchChange} />)

		const field = screen.getByPlaceholderText("Search title or content")
		await user.type(field, "abc")
		expect(field).toHaveValue("abc")

		await waitFor(
			() => {
				expect(onSearchChange).toHaveBeenCalledWith("abc")
			},
			{ timeout: 2000 },
		)
	})

	it("creates a document directly with the default title from the create menu", async () => {
		const user = userEvent.setup()
		render(<Harness />)

		await user.click(screen.getByTestId("documents-root-add"))
		await user.click(await screen.findByText("Document"))

		await waitFor(() => {
			expect(mockCreate).toHaveBeenCalledWith(
				{ kind: "document", title: "Untitled document" },
				expect.anything(),
			)
		})
	})

	it("creates a folder directly with the default title from the create menu", async () => {
		const user = userEvent.setup()
		render(<Harness />)

		await user.click(screen.getByTestId("documents-root-add"))
		await user.click(await screen.findByText("Folder"))

		await waitFor(() => {
			expect(mockCreate).toHaveBeenCalledWith(
				{ kind: "folder", title: "Untitled folder" },
				expect.anything(),
			)
		})
	})

	it("hides search and create in trash mode but keeps trash and appearance", () => {
		render(<Harness trashMode={true} />)

		expect(screen.queryByPlaceholderText("Search title or content")).toBeNull()
		expect(screen.queryByTestId("documents-root-add")).toBeNull()
		expect(screen.queryByTestId("documents-filter-toggle")).toBeNull()
		expect(screen.queryByTestId("documents-edit-mode-toggle")).toBeNull()
		expect(screen.queryByTestId("documents-reading-view-toggle")).toBeNull()
		expect(screen.getByTestId("documents-open-trash")).toBeInTheDocument()
		expect(
			screen.getByTestId("documents-appearance-settings"),
		).toBeInTheDocument()
	})

	it("forwards the filter toggle and shows a badge while filters are set", async () => {
		const user = userEvent.setup()
		const onOpenFilter = vi.fn()
		const { rerender } = render(<Harness onOpenFilter={onOpenFilter} />)

		await user.click(screen.getByTestId("documents-filter-toggle"))
		expect(onOpenFilter).toHaveBeenCalledTimes(1)

		rerender(
			<Harness
				onOpenFilter={onOpenFilter}
				charIds={["char-1"]}
				resIds={["res-1"]}
			/>,
		)
		const toggle = screen.getByTestId("documents-filter-toggle")
		expect(toggle).toHaveAttribute("aria-pressed", "true")
		expect(toggle).toHaveTextContent("2")
	})

	it("shows the section label and document count, hidden in trash mode", () => {
		const { rerender } = render(<Harness count={7} />)

		expect(screen.getByText("Documents")).toBeInTheDocument()
		expect(screen.getByText("7")).toBeInTheDocument()

		rerender(<Harness count={7} trashMode={true} />)
		expect(screen.queryByText("Documents")).toBeNull()
	})

	it("forwards clicks on the reading view toggle", async () => {
		const user = userEvent.setup()
		const onToggleReadingView = vi.fn()
		render(<Harness onToggleReadingView={onToggleReadingView} />)

		await user.click(screen.getByTestId("documents-reading-view-toggle"))

		expect(onToggleReadingView).toHaveBeenCalledTimes(1)
	})

	it("disables the reading view toggle when no document is open", () => {
		render(<Harness readingViewDisabled={true} />)

		expect(screen.getByTestId("documents-reading-view-toggle")).toBeDisabled()
	})
})
