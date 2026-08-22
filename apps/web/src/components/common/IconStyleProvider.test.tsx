import { Icon } from "@hoardodile/ui/components/icon"
import { Bolt } from "@hoardodile/ui/icons/registry"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { prefKeys } from "@/lib/keys"
import { prefSyncStore } from "@/lib/prefSyncStore"
import { IconStyleProvider, useIconStyle } from "./IconStyleProvider"

function iconClass(container: HTMLElement): string | null {
	return container.querySelector("svg")?.getAttribute("class") ?? null
}

function Switcher() {
	const { iconStyle, setIconStyle } = useIconStyle()
	return (
		<button
			type="button"
			aria-label="switch"
			onClick={() =>
				setIconStyle(iconStyle === "linear" ? "duotone" : "linear")
			}
		/>
	)
}

function renderIconStyleProvider() {
	const utils = render(
		<IconStyleProvider>
			<Icon icon={Bolt} />
			<Switcher />
		</IconStyleProvider>,
	)
	return utils
}

function renderDirect() {
	const utils = render(
		<IconStyleProvider>
			<Bolt className="size-4" />
			<Switcher />
		</IconStyleProvider>,
	)
	return utils
}

beforeEach(() => {
	prefSyncStore.delete(prefKeys.iconStyle)
	localStorage.removeItem(prefKeys.iconStyle)
	delete document.documentElement.dataset.iconStyle
})

describe("IconStyleProvider", () => {
	it("defaults to duotone — icons render BoldDuotone", () => {
		const { container } = renderIconStyleProvider()
		expect(document.documentElement.dataset.iconStyle).toBe("duotone")
		expect(iconClass(container)).toContain("solar-bolt-bold-duotone")
	})

	it("swaps icons to their linear counterparts in linear mode", async () => {
		const user = userEvent.setup()
		const { container } = renderIconStyleProvider()

		await user.click(screen.getByRole("button", { name: "switch" }))

		expect(document.documentElement.dataset.iconStyle).toBe("linear")
		await waitFor(() => {
			expect(iconClass(container)).toContain("solar-bolt-linear")
			expect(iconClass(container)).not.toContain("bold-duotone")
		})
	})

	it("restores the BoldDuotone glyphs when switching back to duotone", async () => {
		const user = userEvent.setup()
		const { container } = renderIconStyleProvider()

		await user.click(screen.getByRole("button", { name: "switch" }))
		await user.click(screen.getByRole("button", { name: "switch" }))

		expect(document.documentElement.dataset.iconStyle).toBe("duotone")
		await waitFor(() => {
			expect(iconClass(container)).toContain("solar-bolt-bold-duotone")
		})
	})

	it("follows the style for direct `<Bolt />` renders outside the ui Icon", async () => {
		const user = userEvent.setup()
		const { container } = renderDirect()

		expect(iconClass(container)).toContain("solar-bolt-bold-duotone")

		await user.click(screen.getByRole("button", { name: "switch" }))

		await waitFor(() => {
			expect(iconClass(container)).toContain("solar-bolt-linear")
			expect(iconClass(container)).not.toContain("bold-duotone")
		})
	})

	it("carries the hd-icon hook class on direct renders", () => {
		const { container } = renderDirect()
		expect(iconClass(container)).toContain("hd-icon")
		expect(iconClass(container)).toContain("size-4")
	})
})
