/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest"
import { clearSessionCookies } from "./session-cookie.ts"

describe("clearSessionCookies", () => {
	it("clears only the cookies storage", async () => {
		const clearStorageData = vi.fn(async () => {})
		await clearSessionCookies({ clearStorageData })
		expect(clearStorageData).toHaveBeenCalledWith({ storages: ["cookies"] })
	})
})
