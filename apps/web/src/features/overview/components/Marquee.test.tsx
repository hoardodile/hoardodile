import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Marquee, MarqueeChevrons, type MarqueeHandle } from "./Marquee"

/** Mock strip geometry: 5 cards × 100px with 16px gaps inside a 400px
    container — one copy is 564px, two copies are 580px apart. */
const CARD = 100
const GAP = 16
const CARDS = 5
const COPY_WIDTH = CARDS * CARD + (CARDS - 1) * GAP
const PERIOD = COPY_WIDTH + GAP
const OFFSETS = Array.from({ length: CARDS }, (_, i) => i * (CARD + GAP))
const CONTAINER_WIDTH = 400
/** Left edge of the last card in a 3-copy window. */
const LAST_EDGE = PERIOD * 2 + OFFSETS.at(-1)!

const originalResizeObserver = window.ResizeObserver
const originalMatchMedia = window.matchMedia

const scrollToMock = vi.fn()
Object.defineProperty(Element.prototype, "scrollTo", {
	writable: true,
	configurable: true,
	value: scrollToMock,
})

/** Lets tests trigger the overflow measure after mocking geometry. */
class ControlledResizeObserver {
	static instances: ControlledResizeObserver[] = []
	private callback: ResizeObserverCallback

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback
		ControlledResizeObserver.instances.push(this)
	}

	observe() {}
	unobserve() {}
	disconnect() {}

	emit() {
		this.callback([], this)
	}
}

function rect(left: number): DOMRect {
	return {
		left,
		top: 0,
		right: 0,
		bottom: 0,
		width: 0,
		height: 0,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	} as DOMRect
}

/** Mocks the layout of every rendered copy: copy `i` spans
    `[i·PERIOD, i·PERIOD + COPY_WIDTH)`. */
function mockGeometry() {
	const row = document.querySelector(".w-max") as HTMLElement
	const container = document.querySelector(".overflow-x-auto") as HTMLElement
	const copies = Array.from(row.querySelectorAll(":scope > div"))
	Object.defineProperty(container, "clientWidth", {
		value: CONTAINER_WIDTH,
		configurable: true,
	})
	copies.forEach((copy, i) => {
		Object.defineProperty(copy, "offsetWidth", {
			value: COPY_WIDTH,
			configurable: true,
		})
		Object.defineProperty(copy, "getBoundingClientRect", {
			configurable: true,
			value: () => rect(PERIOD * i),
		})
	})
	return { container, copies }
}

/** Card edges across all copies as viewport-relative rects, derived from
    the current scroll position on every call. */
function mockBoundaries() {
	const row = document.querySelector(".w-max") as HTMLElement
	const container = document.querySelector(".overflow-x-auto") as HTMLElement
	Array.from(row.querySelectorAll(":scope > div")).forEach((copy, i) => {
		Array.from(copy.children).forEach((child, j) => {
			Object.defineProperty(child, "getBoundingClientRect", {
				configurable: true,
				value: () => rect(OFFSETS[j]! + PERIOD * i - container.scrollLeft),
			})
		})
	})
}

function mockScrollLeft(value: number) {
	const container = document.querySelector(".overflow-x-auto") as HTMLElement
	Object.defineProperty(container, "scrollLeft", {
		value,
		writable: true,
		configurable: true,
	})
	return container
}

function renderMarquee(intervalMs?: number) {
	return render(
		<Marquee intervalMs={intervalMs}>
			<div>card-a</div>
			<div>card-b</div>
			<div>card-c</div>
			<div>card-d</div>
			<div>card-e</div>
		</Marquee>,
	)
}

async function emitOverflow() {
	await act(async () => {
		mockGeometry()
		ControlledResizeObserver.instances.at(-1)?.emit()
	})
	mockGeometry()
	mockBoundaries()
	return document.querySelector(".overflow-x-auto") as HTMLElement
}

function renderWithChevrons(intervalMs?: number) {
	const handleRef = createRef<MarqueeHandle>()
	const element = (
		<>
			<MarqueeChevrons stripRef={handleRef} />
			<Marquee ref={handleRef} intervalMs={intervalMs}>
				<div>card-a</div>
				<div>card-b</div>
				<div>card-c</div>
				<div>card-d</div>
				<div>card-e</div>
			</Marquee>
		</>
	)
	return { handleRef, element }
}

beforeEach(() => {
	scrollToMock.mockReset()
	ControlledResizeObserver.instances.length = 0
	Object.defineProperty(window, "ResizeObserver", {
		writable: true,
		configurable: true,
		value: ControlledResizeObserver,
	})
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		configurable: true,
		value: originalMatchMedia,
	})
})

afterEach(() => {
	Object.defineProperty(window, "ResizeObserver", {
		writable: true,
		configurable: true,
		value: originalResizeObserver,
	})
})

describe("Marquee", () => {
	it("renders a single static row when content fits", async () => {
		renderMarquee()
		// The controlled observer never fires — no overflow, no timers.
		await act(async () => {})
		const row = document.querySelector(".w-max")
		expect(row?.children).toHaveLength(1)
		expect(screen.getByText("card-a")).toBeInTheDocument()
		expect(screen.getByText("card-e")).toBeInTheDocument()
	})

	it("renders a sliding window of copies and auto-steps when overflowing", async () => {
		vi.useFakeTimers()
		renderMarquee()
		await emitOverflow()
		expect(document.querySelectorAll(".w-max > div")).toHaveLength(3)

		await act(async () => {
			vi.advanceTimersByTime(8000)
		})
		// The first auto-step also slides a fresh copy in before the start;
		// the glide lands on the second card, one period further.
		expect(scrollToMock).toHaveBeenCalledTimes(1)
		expect(scrollToMock).toHaveBeenCalledWith({
			left: OFFSETS[1]! + PERIOD,
			behavior: "smooth",
		})
	})

	it("pauses auto-stepping while hovered", async () => {
		vi.useFakeTimers()
		renderMarquee()
		await emitOverflow()

		fireEvent.mouseEnter(document.querySelector(".relative")!)
		await act(async () => {
			vi.advanceTimersByTime(10_000)
		})
		expect(scrollToMock).not.toHaveBeenCalled()

		fireEvent.mouseLeave(document.querySelector(".relative")!)
		await act(async () => {
			vi.advanceTimersByTime(8000)
		})
		expect(scrollToMock).toHaveBeenCalledTimes(1)
	})

	it("chevrons step the strip and suspend auto-stepping", async () => {
		vi.useFakeTimers()
		render(renderWithChevrons().element)
		await emitOverflow()
		mockScrollLeft(0)

		fireEvent.click(screen.getByLabelText("Next"))
		expect(scrollToMock).toHaveBeenCalledWith({
			left: OFFSETS[1]! + PERIOD,
			behavior: "smooth",
		})

		// A manual step leaves the user alone for 10s…
		await act(async () => {
			vi.advanceTimersByTime(5000)
		})
		expect(scrollToMock).toHaveBeenCalledTimes(1)
		// …past the pause the next interval tick fires the auto-step.
		await act(async () => {
			vi.advanceTimersByTime(6000)
		})
		expect(scrollToMock).toHaveBeenCalledTimes(1)
		await act(async () => {
			vi.advanceTimersByTime(5000)
		})
		expect(scrollToMock).toHaveBeenCalledTimes(2)

		mockGeometry()
		mockBoundaries()
		mockScrollLeft(OFFSETS[1]! + PERIOD)
		fireEvent.click(screen.getByLabelText("Previous"))
		expect(scrollToMock).toHaveBeenLastCalledWith({
			left: PERIOD,
			behavior: "smooth",
		})
	})

	it("previous steps one card back from mid-strip", async () => {
		render(renderWithChevrons().element)
		await emitOverflow()
		mockScrollLeft(OFFSETS[1]!)

		fireEvent.click(screen.getByLabelText("Previous"))
		// The step is deferred one period: a fresh copy slides in before the
		// strip, the compensation keeps the pixels still, then the glide
		// lands on the first card.
		expect(scrollToMock).toHaveBeenCalledWith({
			left: PERIOD,
			behavior: "smooth",
		})
	})

	it("previous at the start extends the window instead of wrapping", async () => {
		render(renderWithChevrons().element)
		await emitOverflow()
		mockScrollLeft(0)

		fireEvent.click(screen.getByLabelText("Previous"))
		// A fresh copy slides in before the first card; the step lands on
		// its last card — the card "before" the first one — never jumping
		// to the far end of the strip.
		expect(scrollToMock).toHaveBeenCalledWith({
			left: OFFSETS.at(-1)!,
			behavior: "smooth",
		})
		expect(document.querySelectorAll(".w-max > div")).toHaveLength(3)
	})

	it("next at the end extends the window instead of wrapping", async () => {
		render(renderWithChevrons().element)
		await emitOverflow()
		mockScrollLeft(LAST_EDGE)

		fireEvent.click(screen.getByLabelText("Next"))
		// A fresh copy is appended and the window re-baselines; the step
		// lands on the first card of the fresh copy.
		expect(scrollToMock).toHaveBeenCalledWith({
			left: PERIOD * 2,
			behavior: "smooth",
		})
		expect(document.querySelectorAll(".w-max > div")).toHaveLength(4)

		// A second step keeps moving forward — the window re-baselines
		// (drop head, compensate one period) and the glide follows suit.
		mockGeometry()
		mockBoundaries()
		mockScrollLeft(PERIOD * 2)
		fireEvent.click(screen.getByLabelText("Next"))
		expect(scrollToMock).toHaveBeenLastCalledWith({
			left: PERIOD + OFFSETS[1]!,
			behavior: "smooth",
		})

		// A third step carries on — no jump back to the start.
		mockGeometry()
		mockBoundaries()
		mockScrollLeft(PERIOD + OFFSETS[1]!)
		fireEvent.click(screen.getByLabelText("Next"))
		expect(scrollToMock).toHaveBeenLastCalledWith({
			left: PERIOD + OFFSETS[2]!,
			behavior: "smooth",
		})
	})

	it("manual scrolling extends the window at both edges", async () => {
		renderMarquee()
		const container = await emitOverflow()

		// Scrolled left into the head copy: a fresh copy slides in before
		// it and the scroll position is compensated by one period.
		mockScrollLeft(0)
		mockBoundaries()
		await act(async () => {
			fireEvent.scroll(container)
		})
		expect(container.scrollLeft).toBe(PERIOD)

		// Scrolled past the tail copy: the window grows and re-baselines by
		// dropping the head copy.
		mockGeometry()
		mockScrollLeft(LAST_EDGE)
		mockBoundaries()
		await act(async () => {
			fireEvent.scroll(container)
		})
		expect(container.scrollLeft).toBe(LAST_EDGE - PERIOD)
		expect(document.querySelectorAll(".w-max > div")).toHaveLength(4)
	})

	it("vertical wheel scrolls horizontally; horizontal deltas pass through", async () => {
		renderMarquee()
		const container = await emitOverflow()
		mockScrollLeft(PERIOD + OFFSETS[1]!)

		const vertical = new WheelEvent("wheel", { deltaY: 40, cancelable: true })
		await act(async () => {
			container.dispatchEvent(vertical)
		})
		expect(vertical.defaultPrevented).toBe(true)
		expect(container.scrollLeft).toBe(PERIOD + OFFSETS[1]! + 40)

		const horizontal = new WheelEvent("wheel", { deltaX: 30, cancelable: true })
		await act(async () => {
			container.dispatchEvent(horizontal)
		})
		expect(horizontal.defaultPrevented).toBe(false)
		expect(container.scrollLeft).toBe(PERIOD + OFFSETS[1]! + 40)
	})

	it("wheel at the start edge extends the window for room", async () => {
		renderMarquee()
		const container = await emitOverflow()
		mockScrollLeft(0)

		const vertical = new WheelEvent("wheel", { deltaY: 40, cancelable: true })
		await act(async () => {
			container.dispatchEvent(vertical)
		})
		// A fresh copy slides in (compensation +PERIOD) so the gesture
		// keeps room beyond the start.
		expect(container.scrollLeft).toBe(PERIOD + 40)
	})

	it("reduced motion disables auto-stepping and jumps instantly", async () => {
		vi.useFakeTimers()
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			configurable: true,
			value: (query: string) => ({
				matches: true,
				media: query,
				onchange: null,
				addListener: () => undefined,
				removeListener: () => undefined,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				dispatchEvent: () => false,
			}),
		})
		render(renderWithChevrons().element)
		await emitOverflow()
		mockScrollLeft(0)

		await act(async () => {
			vi.advanceTimersByTime(10_000)
		})
		expect(scrollToMock).not.toHaveBeenCalled()

		fireEvent.click(screen.getByLabelText("Next"))
		expect(scrollToMock).toHaveBeenCalledWith({
			left: OFFSETS[1]! + PERIOD,
			behavior: "auto",
		})
	})
})
