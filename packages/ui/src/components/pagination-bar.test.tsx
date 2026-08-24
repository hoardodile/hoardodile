import { fireEvent, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderWithI18n } from "../test/i18n"
import { PaginationBar } from "./pagination-bar"

let mobileMock = false

vi.mock("@hoardodile/ui/hooks/use-mobile", () => ({
	useBelowMd: () => mobileMock,
}))

describe("PaginationBar", () => {
	beforeEach(() => {
		mobileMock = false
	})

	it("renders the asymmetric window with first, last and the total label", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		renderWithI18n(
			<PaginationBar
				page={6}
				pageCount={68}
				totalLabel="68 items"
				onChangePage={() => {}}
			/>,
		)
		for (const page of ["1", "5", "6", "7", "8", "68"]) {
			expect(screen.getByRole("button", { name: page })).toBeInTheDocument()
		}
		expect(screen.getByTestId("pagination-current")).toHaveTextContent("6")
		expect(screen.getAllByText("…")).toHaveLength(2)
		expect(screen.getByText("68 items")).toBeInTheDocument()
		expect(errorSpy).not.toHaveBeenCalled()
		errorSpy.mockRestore()
	})

	it("collapses to a page/total chip below the md breakpoint", () => {
		mobileMock = true
		renderWithI18n(
			<PaginationBar
				page={6}
				pageCount={68}
				totalLabel="68 items"
				onChangePage={() => {}}
			/>,
		)
		expect(screen.getByTestId("pagination-current")).toHaveTextContent("6/68")
		expect(screen.queryByRole("button", { name: "5" })).not.toBeInTheDocument()
		expect(screen.queryByText("…")).not.toBeInTheDocument()
	})

	it("disables the prev chevron on the first page without hover", async () => {
		const onChangePage = vi.fn()
		const user = userEvent.setup()
		renderWithI18n(
			<PaginationBar
				page={1}
				pageCount={3}
				totalLabel="3 items"
				onChangePage={onChangePage}
			/>,
		)
		const prev = screen.getByRole("button", { name: "Prev" })
		expect(prev).toBeDisabled()
		await user.click(prev)
		expect(onChangePage).not.toHaveBeenCalled()
	})

	it("jumps to a clamped page via the go-to field", async () => {
		const onChangePage = vi.fn()
		const user = userEvent.setup()
		renderWithI18n(
			<PaginationBar
				page={3}
				pageCount={10}
				totalLabel="10 items"
				onChangePage={onChangePage}
			/>,
		)
		const input = screen.getByRole("spinbutton")
		await user.click(input)
		fireEvent.change(input, { target: { value: "12" } })
		fireEvent.submit(input.closest("form")!)
		expect(onChangePage).toHaveBeenCalledWith(10)
	})
})
