import { render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { MatchThumbStrip, similarityPercent } from "./MatchThumbStrip"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) => {
			if (params === undefined) return key
			return `${key}(${JSON.stringify(params)})`
		},
	}),
}))

describe("similarityPercent", () => {
	test("maps hamming distance onto a percentage", () => {
		expect(similarityPercent(64, 0)).toBe(100)
		expect(similarityPercent(64, 8)).toBe(88)
		expect(similarityPercent(64, 64)).toBe(0)
		expect(similarityPercent(48, 24)).toBe(50)
	})
})

describe("MatchThumbStrip", () => {
	test("renders a preview per file with name+percent tooltips", () => {
		render(
			<MatchThumbStrip
				resId="res-1"
				files={[
					{ scope: "1.jpg", bits: 64, distance: 2 },
					{ scope: "2.jpg", bits: 64, distance: 8 },
				]}
			/>,
		)

		const imgs = screen.getAllByRole("img")
		expect(imgs).toHaveLength(2)
		expect(imgs[0]).toHaveAttribute(
			"src",
			"/api/resources/res-1/files/1.jpg?size=preview",
		)
		expect(imgs[0]).toHaveAttribute("title")
		expect(imgs[0]?.getAttribute("title")).toContain('"percent":97')
		expect(imgs[1]?.getAttribute("title")).toContain('"percent":88')
	})

	test("caps visible thumbs and counts the hidden rest", () => {
		const files = Array.from({ length: 8 }, (_, i) => ({
			scope: `${i}.jpg`,
		}))
		render(<MatchThumbStrip resId="res-1" files={files} />)

		expect(screen.getAllByRole("img")).toHaveLength(6)
		expect(screen.getByText("+2")).toBeInTheDocument()
	})

	test("files without distance keep the plain name as tooltip", () => {
		render(<MatchThumbStrip resId="res-1" files={[{ scope: "1.jpg" }]} />)

		expect(screen.getByRole("img")).toHaveAttribute("title", "1.jpg")
	})
})
