import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, test, vi } from "vitest"
import { TraitValueField } from "./TraitValueField"

function NumberField({
	initialValue = "",
}: {
	readonly initialValue?: string
}) {
	const [value, setValue] = useState(initialValue)
	return <TraitValueField kind="number" value={value} onChange={setValue} />
}

describe("TraitValueField number", () => {
	test("types a trailing plus and keeps it when reopening the editor", async () => {
		const user = userEvent.setup()
		const { unmount } = render(<NumberField />)
		const input = screen.getByRole("textbox")

		await user.type(input, "10000+")
		expect(input).toHaveValue("10000+")

		unmount()
		render(<NumberField initialValue="10000+" />)
		const reopened = screen.getByRole("textbox")
		expect(reopened).toHaveValue("10000+")
		await user.type(reopened, "{Backspace}")
		expect(reopened).toHaveValue("10000")
		await user.clear(reopened)
		expect(reopened).toHaveValue("")
	})

	test.each(["-12.5", ".5+", "1.25e+4+"])(
		"keeps %s editable without normalizing each keystroke",
		async (value) => {
			const user = userEvent.setup()
			render(<NumberField />)
			const input = screen.getByRole("textbox")

			await user.type(input, value)
			expect(input).toHaveValue(value)
		},
	)

	test("rejects text pasted into a numeric value", async () => {
		const user = userEvent.setup()
		const onChange = vi.fn()
		render(<TraitValueField kind="number" value="10000" onChange={onChange} />)
		const input = screen.getByRole("textbox")

		await user.click(input)
		await user.paste("abc")
		expect(onChange).not.toHaveBeenCalled()
		expect(input).toHaveValue("10000")
	})
})
