import type { DocNode } from "@hoardodile/schemas"
import { QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { useMemo } from "react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createQueryClient } from "@/trpc/client"
import { useDocTreeExpansion } from "./useDocTreeExpansion"

const trpcQuery = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null))
const trpcMutate = vi.fn((..._args: unknown[]) =>
	Promise.resolve<unknown>(undefined),
)

vi.mock("@/trpc/factory", () => ({
	trpcQuery: (...args: unknown[]) => trpcQuery(...args),
	trpcMutate: (...args: unknown[]) => trpcMutate(...args),
}))

function node(
	id: string,
	kind: "folder" | "document",
	parentId?: string,
): DocNode {
	return {
		id,
		parentId,
		kind,
		title: id,
		position: 0,
		createdAt: 1,
		updatedAt: 1,
	}
}

describe("useDocTreeExpansion", () => {
	const tree = [
		node("folder-a", "folder"),
		node("folder-b", "folder"),
		node("doc-in-a", "document", "folder-a"),
		node("doc-in-b", "document", "folder-b"),
		node("orphan-doc", "document"),
	]

	function Wrapper({ children }: { readonly children: ReactNode }) {
		const client = useMemo(() => createQueryClient(), [])
		return <QueryClientProvider client={client}>{children}</QueryClientProvider>
	}

	beforeEach(() => {
		trpcQuery.mockReset()
		trpcMutate.mockReset()
		trpcQuery.mockResolvedValue(null)
		trpcMutate.mockResolvedValue(undefined)
	})

	afterEach(() => {
		// Flush any in-flight scheduler writes so state does not leak between tests.
		window.dispatchEvent(new Event("pagehide"))
		vi.clearAllMocks()
	})

	test("starts collapsed when nothing is stored", async () => {
		const { result } = renderHook(() => useDocTreeExpansion(tree), {
			wrapper: Wrapper,
		})

		await waitFor(() => expect(result.current.expandedIds.size).toBe(0))
		expect(result.current.allExpanded).toBe(false)
		expect(result.current.hasExpandableNodes).toBe(true)
	})

	test("drops stored ids that no longer exist in the tree", async () => {
		trpcQuery.mockResolvedValueOnce({
			value: JSON.stringify(["folder-a", "ghost"]),
			updatedAt: 1,
		})

		const { result } = renderHook(() => useDocTreeExpansion(tree), {
			wrapper: Wrapper,
		})

		await waitFor(() =>
			expect(result.current.expandedIds).toEqual(new Set(["folder-a"])),
		)
	})

	test("toggleExpanded adds and removes ids", async () => {
		const { result } = renderHook(() => useDocTreeExpansion(tree), {
			wrapper: Wrapper,
		})
		await waitFor(() => expect(result.current.expandedIds.size).toBe(0))

		act(() => result.current.toggleExpanded("folder-a"))
		await waitFor(() =>
			expect(result.current.expandedIds).toEqual(new Set(["folder-a"])),
		)

		act(() => result.current.toggleExpanded("folder-a"))
		await waitFor(() => expect(result.current.expandedIds.size).toBe(0))
	})

	test("expandIds expands a batch without collapsing others", async () => {
		trpcQuery.mockResolvedValueOnce({
			value: JSON.stringify(["folder-a"]),
			updatedAt: 1,
		})

		const { result } = renderHook(() => useDocTreeExpansion(tree), {
			wrapper: Wrapper,
		})
		await waitFor(() =>
			expect(result.current.expandedIds).toEqual(new Set(["folder-a"])),
		)

		act(() => result.current.expandIds(["folder-b"]))
		await waitFor(() =>
			expect(result.current.expandedIds).toEqual(
				new Set(["folder-a", "folder-b"]),
			),
		)
	})

	test("toggleExpandAll expands every expandable folder and collapses again", async () => {
		const { result } = renderHook(() => useDocTreeExpansion(tree), {
			wrapper: Wrapper,
		})
		await waitFor(() => expect(result.current.allExpanded).toBe(false))

		act(() => result.current.toggleExpandAll())
		await waitFor(() =>
			expect(result.current.expandedIds).toEqual(
				new Set(["folder-a", "folder-b"]),
			),
		)
		expect(result.current.allExpanded).toBe(true)

		act(() => result.current.toggleExpandAll())
		await waitFor(() => expect(result.current.expandedIds.size).toBe(0))
		expect(result.current.allExpanded).toBe(false)
	})

	test("reports no expandable nodes for a flat list", async () => {
		const { result } = renderHook(
			() => useDocTreeExpansion([node("only-doc", "document")]),
			{ wrapper: Wrapper },
		)

		await waitFor(() => expect(result.current.hasExpandableNodes).toBe(false))
		expect(result.current.allExpanded).toBe(false)
	})
})
