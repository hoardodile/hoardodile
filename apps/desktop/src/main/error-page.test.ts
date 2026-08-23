/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { devServerErrorMessage, serverErrorMessage } from "./error-page.ts"

const LOCALIZED_LANGUAGES = ["zh", "ja", "de", "es"] as const

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

	it("localizes the server message for every additional language", () => {
		for (const language of LOCALIZED_LANGUAGES) {
			expect(
				serverErrorMessage(language),
				`serverErrorMessage(${language}) should not be the English copy`,
			).not.toBe(serverErrorMessage("en"))
		}
	})

	// `pnpm dev` is DO-NOT-TRANSLATE: it stays byte-identical in every
	// catalog, which makes it the stable thing to assert on.
	it("keeps the dev hint stable across languages", () => {
		for (const language of LOCALIZED_LANGUAGES) {
			expect(devServerErrorMessage(language)).toContain("pnpm dev")
		}
	})
})
