import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DocDetailMeta } from "./DocDetailMeta"

describe("DocDetailMeta", () => {
	it("shows only the char count while exposure is loading", () => {
		render(<DocDetailMeta charCount={1234} exposure={undefined} />)

		const meta = screen.getByTestId("document-detail-meta")
		expect(meta).toHaveTextContent("1,234 chars")
		expect(meta).not.toHaveTextContent("watched")
		expect(meta).not.toHaveTextContent("views")
	})

	it("shows only the char count when the document was never viewed", () => {
		render(
			<DocDetailMeta
				charCount={42}
				exposure={{ viewCount: 0, totalMs: 0, lastViewedAt: null }}
			/>,
		)

		const meta = screen.getByTestId("document-detail-meta")
		expect(meta).toHaveTextContent("42 chars")
		expect(meta).not.toHaveTextContent("views")
	})

	it("appends watched time, views and last viewed once viewed", () => {
		render(
			<DocDetailMeta
				charCount={42}
				exposure={{
					viewCount: 3,
					totalMs: 3_660_000,
					lastViewedAt: Date.parse("2026-01-02T03:04:05Z"),
				}}
			/>,
		)

		const meta = screen.getByTestId("document-detail-meta")
		expect(meta).toHaveTextContent("42 chars")
		expect(meta).toHaveTextContent("watched")
		expect(meta).toHaveTextContent("3 views")
		expect(meta).toHaveTextContent(/last viewed/i)
	})
})
