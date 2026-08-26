import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it } from "vitest"
import { DocDetailMeta } from "./DocDetailMeta"

const CREATED_AT = Date.parse("2026-01-02T03:04:05Z")
const UPDATED_AT = Date.parse("2026-03-04T05:06:07Z")

function renderMeta(props: Partial<ComponentProps<typeof DocDetailMeta>> = {}) {
	return render(
		<DocDetailMeta
			charCount={1234}
			createdAt={CREATED_AT}
			updatedAt={UPDATED_AT}
			exposure={undefined}
			{...props}
		/>,
	)
}

describe("DocDetailMeta", () => {
	it("shows created and updated dates alongside the char count", () => {
		renderMeta()

		const meta = screen.getByTestId("document-detail-meta")
		// The formatter omits the year for current-year dates, so assert on
		// the date shape and the created→updated order instead of a year.
		expect(meta).toHaveTextContent("1,234 chars")
		expect(meta).toHaveTextContent(/Created \d/)
		expect(meta).toHaveTextContent(/Updated \d/)
		const text = meta.textContent ?? ""
		expect(text.indexOf("Created")).toBeLessThan(text.indexOf("Updated"))
	})

	it("shows only the char count while exposure is loading", () => {
		renderMeta()

		const meta = screen.getByTestId("document-detail-meta")
		expect(meta).toHaveTextContent("1,234 chars")
		expect(meta).not.toHaveTextContent("watched")
		expect(meta).not.toHaveTextContent("views")
	})

	it("shows only the char count when the document was never viewed", () => {
		renderMeta({
			charCount: 42,
			exposure: { viewCount: 0, totalMs: 0, lastViewedAt: null },
		})

		const meta = screen.getByTestId("document-detail-meta")
		expect(meta).toHaveTextContent("42 chars")
		expect(meta).not.toHaveTextContent("views")
	})

	it("appends watched time, views and last viewed once viewed", () => {
		renderMeta({
			charCount: 42,
			exposure: {
				viewCount: 3,
				totalMs: 3_660_000,
				lastViewedAt: Date.parse("2026-01-02T03:04:05Z"),
			},
		})

		const meta = screen.getByTestId("document-detail-meta")
		expect(meta).toHaveTextContent("42 chars")
		expect(meta).toHaveTextContent("watched")
		expect(meta).toHaveTextContent("3 views")
		expect(meta).toHaveTextContent(/last viewed/i)
	})

	it("keeps exposure stats on a separate second line", () => {
		renderMeta({
			charCount: 42,
			exposure: {
				viewCount: 3,
				totalMs: 3_660_000,
				lastViewedAt: Date.parse("2026-01-02T03:04:05Z"),
			},
		})

		const meta = screen.getByTestId("document-detail-meta")
		const lines = meta.querySelectorAll("p")
		expect(lines).toHaveLength(2)
		// The first line holds the char count + dates only.
		expect(lines[0]?.textContent).toContain("42 chars")
		expect(lines[0]?.textContent).toContain("Created")
		expect(lines[0]?.textContent).not.toContain("views")
		// The exposure segments live on the second line.
		const exposureLine = screen.getByTestId("document-detail-meta-exposure")
		expect(exposureLine).toHaveTextContent("3 views")
		expect(exposureLine).toHaveTextContent("watched")
		expect(exposureLine).toHaveTextContent(/last viewed/i)
	})

	it("renders a single line without exposure", () => {
		renderMeta()

		const meta = screen.getByTestId("document-detail-meta")
		expect(meta.querySelectorAll("p")).toHaveLength(1)
		expect(
			screen.queryByTestId("document-detail-meta-exposure"),
		).not.toBeInTheDocument()
	})
})
