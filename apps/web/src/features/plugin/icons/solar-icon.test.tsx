import type { IconType } from "@hoardodile/ui/components/icon"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
import { LazySolarIcon, type SolarIconLoader } from "./solar-icon"

/** A probe component that records the props it was rendered with. */
function Probe({ className, mode }: { className?: string; mode?: string }) {
	return <span data-testid="probe" data-mode={mode} data-class={className} />
}
const probeIcon = Probe as unknown as IconType

function fakeLoader(icon: IconType = probeIcon): SolarIconLoader {
	const loader = vi.fn((_name: string) => Promise.resolve(icon))
	return loader as SolarIconLoader
}

describe("LazySolarIcon", () => {
	test("renders nothing while the glyph loads, then the wrapped icon", async () => {
		let resolve!: (icon: IconType) => void
		const loader = vi.fn(
			() => new Promise<IconType>((done) => (resolve = done)),
		) as SolarIconLoader
		const { container } = render(<LazySolarIcon name="heart" loader={loader} />)
		expect(container.firstChild).toBeNull()
		await act(async () => {
			resolve(probeIcon)
		})
		expect(screen.getByTestId("probe")).toBeInTheDocument()
		expect(loader).toHaveBeenCalledWith("heart")
	})

	test("forwards mode and className to the wrapped icon", async () => {
		render(
			<LazySolarIcon
				name="heart"
				mode="bold"
				className="size-4"
				loader={fakeLoader()}
			/>,
		)
		const probe = await screen.findByTestId("probe")
		expect(probe).toHaveAttribute("data-mode", "bold")
		expect(probe).toHaveAttribute("data-class", "size-4")
	})

	test("a loader resolving undefined renders nothing (unknown name)", () => {
		const loader = vi.fn(() =>
			Promise.resolve(undefined),
		) as unknown as SolarIconLoader
		const { container } = render(<LazySolarIcon name="nope" loader={loader} />)
		expect(container.firstChild).toBeNull()
		expect(loader).toHaveBeenCalledWith("nope")
	})
})
