import type { DocNode } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode, useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DocTree } from "./DocTree"

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: { readonly children: ReactNode }) => (
		<a {...props}>{children}</a>
	),
	useNavigate: () => navigateMock,
}))

vi.mock("@/hooks/usePref", () => ({
	usePref<T>(_key: string, defaultValue: T): readonly [T, (value: T) => void] {
		return useState(defaultValue)
	},
}))

vi.mock("@/features/doc/hooks/useDocPrefs", () => ({
	useDocTheme: () => ({
		theme: "parchment",
		themeClass: undefined,
		setTheme: vi.fn(),
	}),
}))

vi.mock("@/trpc/factory", () => ({
	trpcMutation: vi.fn(() => ({ mutationFn: vi.fn() })),
	trpcQuery: vi.fn(),
}))

vi.mock("@/features/doc/useDocDragDrop", () => ({
	useDocumentDragDrop: () => ({
		enabled: false,
		draggedId: undefined,
		hover: undefined,
		contextProps: {
			sensors: [],
			onDragStart: vi.fn(),
			onDragMove: vi.fn(),
			onDragEnd: vi.fn(),
			onDragCancel: vi.fn(),
		},
	}),
	useTreeRowDnd: () => ({
		setNodeRef: vi.fn(),
		listeners: undefined,
		attributes: {},
		isDragging: false,
	}),
}))

function Wrapper({ children }: { readonly children: ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	})
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function TreeHarness(props: { readonly nodes: readonly DocNode[] }) {
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
	return (
		<DocTree
			nodes={props.nodes}
			activeId={undefined}
			expandedIds={expandedIds}
			onToggleExpanded={(id) => {
				setExpandedIds((prev) => {
					const next = new Set(prev)
					if (next.has(id)) next.delete(id)
					else next.add(id)
					return next
				})
			}}
			onExpandIds={(ids) => {
				setExpandedIds((prev) => new Set([...prev, ...ids]))
			}}
		/>
	)
}

describe("DocTree", () => {
	const nodes: readonly DocNode[] = [
		{
			id: "root-folder",
			kind: "folder",
			title: "Root",
			position: 0,
			createdAt: 1,
			updatedAt: 1,
		},
		{
			id: "child-folder",
			kind: "folder",
			title: "Child",
			parentId: "root-folder",
			position: 0,
			createdAt: 2,
			updatedAt: 2,
		},
		{
			id: "grandchild-doc",
			kind: "document",
			title: "Grandchild",
			parentId: "child-folder",
			position: 0,
			createdAt: 3,
			updatedAt: 3,
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("expands and collapses a nested folder independently of its parent", async () => {
		const user = userEvent.setup()

		render(<TreeHarness nodes={nodes} />, {
			wrapper: Wrapper,
		})

		const rootButton = screen.getByRole("button", { name: "Root" })

		// Initially collapsed: neither child nor grandchild rows are rendered.
		expect(
			screen.queryByTestId("documents-row-child-folder"),
		).not.toBeInTheDocument()
		expect(
			screen.queryByTestId("documents-row-grandchild-doc"),
		).not.toBeInTheDocument()

		// Expand the root folder.
		await user.click(rootButton)
		expect(
			screen.queryByTestId("documents-row-child-folder"),
		).toBeInTheDocument()
		expect(
			screen.queryByTestId("documents-row-grandchild-doc"),
		).not.toBeInTheDocument()

		// Expand the child folder.
		const childButton = screen.getByRole("button", { name: "Child" })
		await user.click(childButton)
		expect(
			screen.queryByTestId("documents-row-grandchild-doc"),
		).toBeInTheDocument()

		// Collapsing the root folder hides the whole subtree.
		await user.click(rootButton)
		expect(
			screen.queryByTestId("documents-row-child-folder"),
		).not.toBeInTheDocument()
		expect(
			screen.queryByTestId("documents-row-grandchild-doc"),
		).not.toBeInTheDocument()
	})

	it("toggles a folder when its row body (outside the title) is clicked", async () => {
		render(<TreeHarness nodes={nodes} />, {
			wrapper: Wrapper,
		})

		const rootRow = screen.getByTestId("documents-row-root-folder")
		const rowBody = rootRow.firstElementChild
		if (rowBody === null) throw new Error("row body not found")

		fireEvent.click(rowBody)
		expect(screen.getByTestId("documents-row-child-folder")).toBeInTheDocument()

		fireEvent.click(rowBody)
		expect(
			screen.queryByTestId("documents-row-child-folder"),
		).not.toBeInTheDocument()
	})

	it("navigates to a document when its row body is clicked", async () => {
		const user = userEvent.setup()

		render(<TreeHarness nodes={nodes} />, {
			wrapper: Wrapper,
		})

		// Expand both folders so the document row is visible.
		await user.click(screen.getByRole("button", { name: "Root" }))
		await user.click(screen.getByRole("button", { name: "Child" }))

		const docRow = screen.getByTestId("documents-row-grandchild-doc")
		const rowBody = docRow.firstElementChild
		if (rowBody === null) throw new Error("row body not found")

		fireEvent.click(rowBody)
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/documents/$id",
			params: { id: "grandchild-doc" },
		})
	})
})
