/**
 * @vitest-environment jsdom
 */

import type { DocNode } from "@hoardodile/schemas"
import { renderHook } from "@testing-library/react"
import { TRPCClientError } from "@trpc/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UseDocDeletedExitInput } from "./useDocDeletedExit"
import { useDocDeletedExit } from "./useDocDeletedExit"

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}))

/** The NOT_FOUND error the tRPC client raises for a hard-deleted document. */
function notFoundError(): Error {
	return TRPCClientError.from({
		error: {
			code: -32004,
			message: "document.not_found",
			data: { code: "NOT_FOUND", httpStatus: 404 },
		},
	})
}

function liveNode(): DocNode {
	return {
		id: "doc-1",
		kind: "document",
		title: "Doc",
		position: 0,
		createdAt: 1,
		updatedAt: 1,
	}
}

function trashedNode(): DocNode {
	return { ...liveNode(), deletedAt: 5 }
}

const BASE: UseDocDeletedExitInput = {
	docId: "doc-1",
	isLoading: false,
	node: undefined,
	error: undefined,
}

describe("useDocDeletedExit", () => {
	beforeEach(() => {
		navigateMock.mockClear()
	})

	it("leaves the page when the open document is soft-deleted", () => {
		const { rerender } = renderHook(
			(props: Parameters<typeof useDocDeletedExit>[0]) =>
				useDocDeletedExit(props),
			{ initialProps: { ...BASE, node: liveNode() } },
		)
		expect(navigateMock).not.toHaveBeenCalled()

		rerender({ ...BASE, node: trashedNode() })
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/documents",
			replace: true,
		})
	})

	it("keeps rendering a document that is already trashed when the page mounts", () => {
		renderHook(
			(props: Parameters<typeof useDocDeletedExit>[0]) =>
				useDocDeletedExit(props),
			{ initialProps: { ...BASE, node: trashedNode() } },
		)
		expect(navigateMock).not.toHaveBeenCalled()
	})

	it("leaves the page when the open document is hard-deleted under the user", () => {
		const { rerender, result } = renderHook(
			(props: Parameters<typeof useDocDeletedExit>[0]) =>
				useDocDeletedExit(props),
			{ initialProps: { ...BASE, node: liveNode() } },
		)

		// React Query keeps the last successful payload on a failed refetch,
		// so the stale live node stays "defined" while the query errors.
		rerender({
			...BASE,
			node: liveNode(),
			error: notFoundError(),
		})
		expect(result.current.gone).toBe(true)
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/documents",
			replace: true,
		})
	})

	it("keeps the not-found panel for a document that never resolved", () => {
		const result = renderHook(
			(props: Parameters<typeof useDocDeletedExit>[0]) =>
				useDocDeletedExit(props),
			{ initialProps: { ...BASE, error: notFoundError() } },
		)
		expect(result.result.current.gone).toBe(false)
		expect(navigateMock).not.toHaveBeenCalled()
	})

	it("stays put on a transport failure", () => {
		const networkError = new Error("Failed to fetch")
		const result = renderHook(
			(props: Parameters<typeof useDocDeletedExit>[0]) =>
				useDocDeletedExit(props),
			{ initialProps: { ...BASE, node: liveNode(), error: networkError } },
		)
		expect(result.result.current.gone).toBe(false)
		expect(navigateMock).not.toHaveBeenCalled()
	})

	it("does not inherit the previous document's deletion history", () => {
		const { rerender, result } = renderHook(
			(props: Parameters<typeof useDocDeletedExit>[0]) =>
				useDocDeletedExit(props),
			{ initialProps: { ...BASE, node: liveNode() } },
		)

		// Switching to another document that is already trashed must not
		// reuse the live history of the previous one.
		rerender({
			...BASE,
			docId: "doc-2",
			node: { ...trashedNode(), id: "doc-2" },
		})
		expect(result.current.gone).toBe(false)
		expect(navigateMock).not.toHaveBeenCalled()
	})
})
