import { fireEvent, render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ResAudioPlayer } from "./ResAudioPlayer"

// jsdom implements no media pipeline: play()/pause() are unimplemented and
// `duration` is NaN. Stub just enough for the component's contract.
function stubMediaElement(durationSeconds: number): { play: () => void } {
	const play = vi.fn()
	vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {
		play()
	})
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {})
	vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(
		durationSeconds,
	)
	return { play }
}

describe("ResAudioPlayer", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("streams the resource through the audio passthrough endpoint", () => {
		stubMediaElement(120)
		render(<ResAudioPlayer resId="res-1" resName="Track" variant="tile" />)
		const audio = screen.getByTestId("resource-audio-res-1")
		expect(audio.getAttribute("src")).toBe(
			"/api/resources/res-1/cover?size=original&format=audio",
		)
	})

	it("toggles between play and pause", async () => {
		const media = stubMediaElement(120)
		const user = userEvent.setup()
		render(<ResAudioPlayer resId="res-1" resName="Track" variant="tile" />)

		const toggle = screen.getByTestId("resource-audio-toggle-res-1")
		expect(toggle.getAttribute("aria-label")).toBe("Play Track")
		await user.click(toggle)
		expect(media.play).toHaveBeenCalledTimes(1)
		expect(toggle.getAttribute("aria-label")).toBe("Pause Track")

		await user.click(toggle)
		expect(toggle.getAttribute("aria-label")).toBe("Play Track")
	})

	it("reports the duration read off the media element once known", () => {
		stubMediaElement(90)
		render(<ResAudioPlayer resId="res-1" resName="Track" variant="tile" />)
		fireEvent.loadedMetadata(screen.getByTestId("resource-audio-res-1"))
		expect(screen.getByText("0:00 / 1:30")).toBeTruthy()
	})

	it("renders the resident tile only in the tile variant", () => {
		stubMediaElement(120)
		const { rerender } = render(
			<ResAudioPlayer resId="res-1" resName="Track" variant="tile" />,
		)
		expect(screen.queryByTestId("resource-audio-tile-res-1")).not.toBeNull()

		rerender(<ResAudioPlayer resId="res-1" resName="Track" variant="overlay" />)
		expect(screen.queryByTestId("resource-audio-tile-res-1")).toBeNull()
		expect(screen.queryByTestId("resource-audio-toggle-res-1")).not.toBeNull()
	})
})
