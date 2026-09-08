import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import { WatchOnlyToggleRow } from "./WatchOnlyToggleRow"

function createWrapper() {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return {
		wrapper: function Wrapper({ children }: { readonly children: ReactNode }) {
			return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
		},
		invalidateSpy: vi.spyOn(qc, "invalidateQueries"),
	}
}

describe("WatchOnlyToggleRow", () => {
	beforeEach(() => {
		prefSync.set(prefKeys.watchOnly, "0")
	})

	afterEach(() => {
		prefSync.set(prefKeys.watchOnly, "0")
		vi.restoreAllMocks()
	})

	it("reads the toggle from the stored pref", () => {
		prefSync.set(prefKeys.watchOnly, "1")
		render(<WatchOnlyToggleRow />, { wrapper: createWrapper().wrapper })
		expect(screen.getByTestId("watch-only-toggle")).toBeChecked()
	})

	it("writes the flipped value through prefSync", () => {
		render(<WatchOnlyToggleRow />, { wrapper: createWrapper().wrapper })
		const toggle = screen.getByTestId("watch-only-toggle")
		expect(toggle).not.toBeChecked()
		act(() => fireEvent.click(toggle))
		expect(prefSync.get(prefKeys.watchOnly)).toBe("1")
	})

	it("invalidates the content query roots on flip", () => {
		const { wrapper, invalidateSpy } = createWrapper()
		render(<WatchOnlyToggleRow />, { wrapper })
		act(() => fireEvent.click(screen.getByTestId("watch-only-toggle")))
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["character"],
		})
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["resource"],
		})
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tag"] })
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["category"] })
	})
})
