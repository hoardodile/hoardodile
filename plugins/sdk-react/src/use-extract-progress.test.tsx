import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { StubPluginAPIProvider } from "./fixtures.tsx"
import { useExtractProgress } from "./use-extract-progress.ts"

function jsonResponse(payload: unknown): Response {
	return { json: async () => payload } as Response
}

function renderHarness(progressUrl: () => string = () => "/progress") {
	const container = document.createElement("div")
	document.body.appendChild(container)
	let root: Root | undefined
	act(() => {
		root = createRoot(container)
		root.render(
			<StubPluginAPIProvider api={{ extractProgressUrl: progressUrl }}>
				<ProgressProbe />
			</StubPluginAPIProvider>,
		)
	})
	return { container, root }
}

function ProgressProbe() {
	const progress = useExtractProgress()
	return <div data-testid="state">{JSON.stringify(progress)}</div>
}

function stateOf(container: HTMLElement): Record<string, unknown> {
	return JSON.parse(
		container.querySelector("[data-testid='state']")!.textContent!,
	)
}

describe("useExtractProgress", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
		document.body.innerHTML = ""
	})

	test("starts idle and stays idle while the host reports nothing", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null))
		vi.stubGlobal("fetch", fetchMock)

		const { container, root } = renderHarness()
		await act(async () => {})
		expect(stateOf(container)).toEqual({ state: "idle" })

		await act(async () => {
			vi.advanceTimersByTime(1000)
		})
		expect(stateOf(container)).toEqual({ state: "idle" })
		root?.unmount()
	})

	test("reports in-flight materialization", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(jsonResponse({ done: 3, total: 10 }))
		vi.stubGlobal("fetch", fetchMock)

		const { container, root } = renderHarness()
		await act(async () => {})
		expect(stateOf(container)).toEqual({
			state: "extracting",
			done: 3,
			total: 10,
		})

		await act(async () => {
			vi.advanceTimersByTime(600)
		})
		expect(stateOf(container)).toEqual({
			state: "extracting",
			done: 3,
			total: 10,
		})
		root?.unmount()
	})

	test("turns done once progress was seen and the record went idle", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ done: 5, total: 10 }))
			.mockResolvedValue(jsonResponse(null))
		vi.stubGlobal("fetch", fetchMock)

		const { container, root } = renderHarness()
		await act(async () => {})
		expect(stateOf(container)).toEqual({
			state: "extracting",
			done: 5,
			total: 10,
		})

		await act(async () => {
			vi.advanceTimersByTime(300)
		})
		expect(stateOf(container)).toEqual({ state: "done" })
		root?.unmount()
	})

	test("treats a failed poll as idle", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))

		const { container, root } = renderHarness()
		await act(async () => {})
		expect(stateOf(container)).toEqual({ state: "idle" })
		root?.unmount()
	})
})
