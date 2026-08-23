/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { devServerErrorMessage, serverErrorMessage } from "./error-page.ts"

describe("shell error copy", () => {
	it("exposes the dev-specific message", () => {
		expect(devServerErrorMessage("en")).toContain("pnpm dev")
	})

	it("exposes the generic server message", () => {
		expect(serverErrorMessage("en")).toContain("Retry")
	})

	it("keeps the message functions distinct", () => {
		expect(devServerErrorMessage("en")).not.toBe(serverErrorMessage("en"))
	})

	it("localizes for Chinese", () => {
		expect(devServerErrorMessage("zh")).toContain("pnpm dev")
		expect(serverErrorMessage("zh")).toContain("重试")
	})
})
