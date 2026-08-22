/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { DEV_SERVER_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from "./error-page.ts"

describe("shell error copy", () => {
	it("exposes the dev-specific message", () => {
		expect(DEV_SERVER_ERROR_MESSAGE).toContain("pnpm dev")
	})

	it("exposes the generic server message", () => {
		expect(SERVER_ERROR_MESSAGE).toContain("Retry")
	})

	it("keeps the message constants distinct", () => {
		expect(DEV_SERVER_ERROR_MESSAGE).not.toBe(SERVER_ERROR_MESSAGE)
	})
})
