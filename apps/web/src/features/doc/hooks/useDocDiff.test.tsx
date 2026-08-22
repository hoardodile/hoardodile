import type { DocVersionMeta } from "@hoardodile/schemas"
import { toast } from "@hoardodile/ui/components/toast"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { createRef, type ReactNode } from "react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import type { DocEditorHandle } from "../editor/DocEditor"
import { type UseDocDiffInput, useDocDiff } from "./useDocDiff"

const trpcQuery = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>(null))

vi.mock("@/trpc/factory", () => ({
	trpcQuery: (...args: unknown[]) => trpcQuery(...args),
	trpcMutate: vi.fn(),
}))

vi.mock("@hoardodile/ui/components/toast", () => ({
	toast: { add: vi.fn() },
}))

vi.mock("../diff.ts", () => ({
	loadDiffModule: vi.fn(() =>
		Promise.resolve({
			blocksToDoc: () => ({}),
			computeInlineDiffDoc: () => ({}),
			applyDiffDoc: () => {},
		}),
	),
}))

import { loadDiffModule } from "../diff.ts"

function version(id: string, versionNo: number): DocVersionMeta {
	return {
		id,
		docId: "doc-1",
		versionNo,
		title: `v${versionNo}`,
		charIds: [],
		resIds: [],
		message: "",
		createdAt: 1,
	}
}

function createWrapper(qc: QueryClient) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
	}
}

function setup(overrides: Partial<UseDocDiffInput>) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	const editorHandleRef = createRef<DocEditorHandle | null>()
	const manualSaveAsync = vi.fn(() => Promise.resolve())
	const args: UseDocDiffInput = {
		id: "doc-1",
		versions: [],
		isTrashed: false,
		editorHandleRef,
		manualSaveAsync,
		...overrides,
	}
	return { qc, editorHandleRef, manualSaveAsync, args }
}

describe("useDocDiff", () => {
	beforeEach(() => {
		trpcQuery.mockReset()
		trpcQuery.mockResolvedValue(null)
		vi.mocked(toast.add).mockClear()
		vi.mocked(loadDiffModule).mockClear()
	})

	test("starts out of diff mode and cannot enter without versions", async () => {
		const { args, qc, manualSaveAsync } = setup({})
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await waitFor(() => expect(result.current.diffMode).toBe(false))
		expect(result.current.canEnterDiff).toBe(false)
		expect(result.current.diffVersionId).toBeUndefined()

		await act(async () => {
			await result.current.enterDiff()
		})
		expect(result.current.diffMode).toBe(false)
		expect(manualSaveAsync).not.toHaveBeenCalled()
	})

	test("enterDiff flushes the draft and selects the latest version", async () => {
		const { args, qc, editorHandleRef, manualSaveAsync } = setup({
			versions: [version("v-2", 2), version("v-1", 1)],
		})
		editorHandleRef.current = {
			editor: { document: [{ id: "b1", type: "paragraph" }] },
		} as unknown as DocEditorHandle
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await act(async () => {
			await result.current.enterDiff()
		})

		expect(manualSaveAsync).toHaveBeenCalledTimes(1)
		expect(result.current.diffMode).toBe(true)
		expect(result.current.diffVersionId).toBe("v-2")
		expect(result.current.canEnterDiff).toBe(false)
	})

	test("stays out of diff when the draft flush fails", async () => {
		const { args, qc, editorHandleRef } = setup({
			versions: [version("v-1", 1)],
		})
		editorHandleRef.current = {
			editor: { document: [] },
		} as unknown as DocEditorHandle
		const failingSave = vi.fn(() => Promise.reject(new Error("flush failed")))
		const { result } = renderHook(
			() => useDocDiff({ ...args, manualSaveAsync: failingSave }),
			{ wrapper: createWrapper(qc) },
		)

		await act(async () => {
			await result.current.enterDiff()
		})

		expect(result.current.diffMode).toBe(false)
		expect(result.current.diffVersionId).toBeUndefined()
	})

	test("does nothing without a mounted main editor", async () => {
		const { args, qc, manualSaveAsync } = setup({
			versions: [version("v-1", 1)],
		})
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await act(async () => {
			await result.current.enterDiff()
		})

		expect(manualSaveAsync).not.toHaveBeenCalled()
		expect(result.current.diffMode).toBe(false)
	})

	test("exitDiff resets all diff state", async () => {
		const { args, qc, editorHandleRef } = setup({
			versions: [version("v-1", 1)],
		})
		editorHandleRef.current = {
			editor: { document: [] },
		} as unknown as DocEditorHandle
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await act(async () => {
			await result.current.enterDiff()
		})
		expect(result.current.diffMode).toBe(true)

		act(() => result.current.exitDiff())
		expect(result.current.diffMode).toBe(false)
		expect(result.current.diffVersionId).toBeUndefined()
		expect(result.current.canEnterDiff).toBe(true)
	})

	test("switching documents exits diff mode", async () => {
		const { args, qc, editorHandleRef } = setup({
			versions: [version("v-1", 1)],
		})
		editorHandleRef.current = {
			editor: { document: [] },
		} as unknown as DocEditorHandle
		const { result, rerender } = renderHook(
			(props: UseDocDiffInput) => useDocDiff(props),
			{
				initialProps: args,
				wrapper: createWrapper(qc),
			},
		)

		await act(async () => {
			await result.current.enterDiff()
		})
		expect(result.current.diffMode).toBe(true)

		rerender({ ...args, id: "doc-2" })
		expect(result.current.diffMode).toBe(false)
		expect(result.current.diffVersionId).toBeUndefined()
	})

	test("canEnterDiff is gated by the trashed state", async () => {
		const { args, qc } = setup({
			versions: [version("v-1", 1)],
			isTrashed: true,
		})
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await waitFor(() => expect(result.current.canEnterDiff).toBe(false))
	})

	test("setDiffVersionId switches the inspected version", async () => {
		const { args, qc, editorHandleRef } = setup({
			versions: [version("v-2", 2), version("v-1", 1)],
		})
		editorHandleRef.current = {
			editor: { document: [] },
		} as unknown as DocEditorHandle
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await act(async () => {
			await result.current.enterDiff()
		})
		act(() => result.current.setDiffVersionId("v-1"))
		expect(result.current.diffVersionId).toBe("v-1")
		await waitFor(() =>
			expect(trpcQuery).toHaveBeenCalledWith("document", "getVersion", {
				docId: "doc-1",
				versionId: "v-1",
			}),
		)
	})

	test("diff resolves a legacy empty version shape without stalling", async () => {
		const { args, qc, editorHandleRef } = setup({
			versions: [version("v-1", 1)],
		})
		editorHandleRef.current = {
			editor: { document: [] },
		} as unknown as DocEditorHandle
		// A version committed from an empty draft stores the legacy shape;
		// it must be treated as an empty block list, not a blank diff.
		trpcQuery.mockResolvedValue({
			content: { type: "doc", content: [] },
		})
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await act(async () => {
			await result.current.enterDiff()
		})
		// Mount a read-only diff editor so the apply effect can run.
		result.current.diffEditorHandleRef.current = {
			editor: {
				_tiptapEditor: { state: { schema: {} } },
			},
		} as unknown as DocEditorHandle
		act(() => result.current.onDiffEditorReady())

		// The apply effect proceeds (base blocks resolved) instead of waiting
		// forever for a `.blocks` key that will never arrive.
		await waitFor(() => expect(loadDiffModule).toHaveBeenCalled())
		expect(result.current.diffMode).toBe(true)
	})

	test("exits diff mode when the selected version fails to load", async () => {
		const { args, qc, editorHandleRef } = setup({
			versions: [version("v-1", 1)],
		})
		editorHandleRef.current = {
			editor: { document: [] },
		} as unknown as DocEditorHandle
		trpcQuery.mockRejectedValue(new Error("boom"))
		const { result } = renderHook(() => useDocDiff(args), {
			wrapper: createWrapper(qc),
		})

		await act(async () => {
			await result.current.enterDiff()
		})
		await waitFor(() => expect(result.current.diffMode).toBe(false))
		expect(toast.add).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error" }),
		)
	})
})
