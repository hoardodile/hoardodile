/**
 * @vitest-environment node
 */

import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { handleSseEvent } from "./__root"

vi.mock("@/lib/client-reset", () => ({
	hardResetAndReload: vi.fn(),
}))

const { hardResetAndReload } = await import("@/lib/client-reset")

describe("handleSseEvent", () => {
	it("triggers a full client reset and reload on storageContextReloaded", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})

		await handleSseEvent(
			queryClient,
			{ type: "storageContextReloaded" },
			"Reloading…",
		)

		expect(hardResetAndReload).toHaveBeenCalledTimes(1)
		expect(hardResetAndReload).toHaveBeenCalledWith("Reloading…")
	})

	it("does not reset on resourceMetaUpdated", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		})
		const resetMock = vi.mocked(hardResetAndReload)
		resetMock.mockClear()

		await handleSseEvent(queryClient, {
			type: "resourceMetaUpdated",
			resourceId: "res-1",
			metaTypes: ["coverMeta"],
		})

		expect(hardResetAndReload).not.toHaveBeenCalled()
	})
})
