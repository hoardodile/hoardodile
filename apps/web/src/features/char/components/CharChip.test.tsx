import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, test, vi } from "vitest"
import { CharChip } from "./CharChip"

const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

const { navigateMock, desktopMock } = vi.hoisted(() => ({
	navigateMock: vi.fn(),
	desktopMock: vi.fn(),
}))

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}))

vi.mock("@/lib/desktop", () => ({
	isHoardodileDesktop: () => desktopMock(),
}))

afterEach(() => {
	openSpy.mockClear()
	navigateMock.mockClear()
	desktopMock.mockReset()
	desktopMock.mockReturnValue(false)
})

const char = { name: "Aria", updatedAt: 0 }

function chipButtons(): HTMLElement[] {
	return screen.queryAllByRole("button")
}

describe("CharChip", () => {
	test("the avatar is a design-sized 20px circle", () => {
		const { container } = render(
			<CharChip charId="c1" character={char} showName testId="chip" />,
		)
		const shell = screen.getByTestId("chip")
		const avatar = shell.querySelector(".size-5")
		expect(avatar).not.toBeNull()
		expect(container.querySelector(".size-7")).toBeNull()
	})

	test("only the circular avatar navigates — the name is decorative", async () => {
		const user = userEvent.setup()
		render(<CharChip charId="c1" character={char} showName testId="chip" />)
		expect(chipButtons()).toHaveLength(1)
		await user.click(screen.getByText("Aria"))
		expect(openSpy).not.toHaveBeenCalled()
		fireEvent.click(screen.getByTestId("chip"))
		expect(openSpy).not.toHaveBeenCalled()
		await user.click(chipButtons()[0]!)
		expect(openSpy).toHaveBeenCalledWith(
			"/characters/c1",
			"_blank",
			"noopener,noreferrer",
		)
	})

	test("an avatar-only chip still navigates on the avatar", async () => {
		const user = userEvent.setup()
		render(<CharChip charId="c1" character={char} />)
		await user.click(chipButtons()[0]!)
		expect(openSpy).toHaveBeenCalledTimes(1)
	})

	test("the desktop shell navigates in-app instead of window.open", async () => {
		desktopMock.mockReturnValue(true)
		const user = userEvent.setup()
		render(<CharChip charId="c1" character={char} />)
		await user.click(chipButtons()[0]!)
		expect(openSpy).not.toHaveBeenCalled()
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/characters/$id",
			params: { id: "c1" },
		})
	})

	test("disableLink renders no button at all", () => {
		render(<CharChip charId="c1" character={char} showName disableLink />)
		expect(chipButtons()).toHaveLength(0)
	})

	test("onRemove renders the remove button instead of navigation", async () => {
		const user = userEvent.setup()
		const onRemove = vi.fn()
		render(
			<CharChip
				charId="c1"
				character={char}
				showName
				onRemove={onRemove}
				testId="chip"
			/>,
		)
		const remove = screen.getByTestId("chip-remove")
		expect(chipButtons()).toHaveLength(1)
		await user.click(remove)
		expect(onRemove).toHaveBeenCalledTimes(1)
		expect(openSpy).not.toHaveBeenCalled()
	})

	test("subLabel replaces the name and composes the tooltip", () => {
		render(<CharChip charId="c1" character={char} subLabel="rival" />)
		expect(screen.getByText("rival")).toBeDefined()
		expect(screen.queryByText("Aria")).toBeNull()
		expect(screen.getByTitle("Aria — rival")).toBeDefined()
	})

	test("an unresolved character renders its id instead of a name", () => {
		render(<CharChip charId="c1" character={undefined} showName />)
		expect(screen.getByText("c1")).toBeDefined()
		expect(screen.queryByText("Aria")).toBeNull()
		expect(screen.getByTitle("c1")).toBeDefined()
	})
})
