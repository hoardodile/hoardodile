import { Icon } from "@hoardodile/ui/components/icon"
import { AltArrowLeft, AltArrowRight } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import {
	Children,
	forwardRef,
	type ReactNode,
	type RefObject,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"

/** Fallback window (ms) for the smooth auto-step to settle — manual-scroll
    window corrections stay out of the way while a step is in flight. */
const STEP_MS = 700
/** How long a manual step suspends auto-stepping. */
const MANUAL_PAUSE_MS = 10_000
/** Gap between adjacent cards and copies (the strip row is `gap-4`). */
const GAP = 16
/** Minimum copies in the sliding window: one fully off-screen on each side
    of the viewport plus the visible one. */
const MIN_COPIES = 3
/** Hard ceiling before the window slides — bounds DOM growth. */
const MAX_COPIES = 4

/** Reduced motion: auto-stepping stops entirely; a manual chevron step
    still works but jumps instantly instead of gliding. */
function prefersReducedMotion() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Imperative controls — the section header's chevrons drive the strip. */
export type MarqueeHandle = {
	/** Steps one card and suspends auto-stepping for a while. */
	step: (direction: 1 | -1) => void
}

/** Prev/next chevrons driving a Marquee via its ref handle — rendered in
    the section header, right after the title, so nothing covers the cards. */
export function MarqueeChevrons({
	stripRef,
}: {
	stripRef: RefObject<MarqueeHandle | null>
}) {
	const { t } = useTranslation()
	return (
		<span className="flex items-center gap-0.5">
			<button
				type="button"
				title={t("common.previous")}
				aria-label={t("common.previous")}
				onClick={() => stripRef.current?.step(-1)}
				className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-secondary-foreground"
			>
				<Icon icon={AltArrowLeft} />
			</button>
			<button
				type="button"
				title={t("common.next")}
				aria-label={t("common.next")}
				onClick={() => stripRef.current?.step(1)}
				className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-secondary-foreground"
			>
				<Icon icon={AltArrowRight} />
			</button>
		</span>
	)
}

type MarqueeProps = {
	readonly children: ReactNode
	readonly className?: string
	/** Pause between one-card auto steps — tune to taste. */
	readonly intervalMs?: number
}

/**
 * Infinitely scrolling strip. Every `intervalMs` the strip smooth-scrolls so
 * the next card's left edge lands flush — always aligned to a card
 * boundary, never page-by-page. Manual control comes from the section
 * header's chevrons via the ref handle (no visible scrollbar, nothing
 * covering the cards); a manual step suspends auto-stepping for a while,
 * hovering the strip pauses it too. When the content fits the container it
 * renders fully as a plain static row with no animation.
 *
 * There is no wrap-around: the children render inside a sliding window of
 * identical copies, and the window grows in the direction of travel — a
 * fresh copy is prepended before the head or appended past the tail — so
 * both manual scrolling and stepping can go on forever in either direction
 * without ever jumping back. Copies fully outside the viewport are dropped
 * to bound the DOM; any layout shift is compensated on `scrollLeft` in the
 * same frame, so the pixels never move.
 */
export const Marquee = forwardRef<MarqueeHandle, MarqueeProps>(function Marquee(
	{ children, className, intervalMs = 8000 },
	ref,
) {
	const items = Children.toArray(children)
	const containerRef = useRef<HTMLDivElement>(null)
	const rowRef = useRef<HTMLDivElement>(null)
	const copyRef = useRef<HTMLDivElement>(null)
	const [overflows, setOverflows] = useState(false)
	// The copy window: `windowStart` keys the copies so prepends insert a
	// fresh copy before the head and drops remove it from the tail.
	const [windowStart, setWindowStart] = useState(0)
	const [windowCount, setWindowCount] = useState(1)
	const windowStartRef = useRef(0)
	const windowCountRef = useRef(1)
	const windowChangeQueuedRef = useRef(false)
	const shiftRef = useRef(0)
	const pendingScrollRef = useRef<number | null>(null)
	const steppingRef = useRef(false)
	const hoveringRef = useRef(false)
	const pausedUntilRef = useRef(0)

	useEffect(() => {
		const container = containerRef.current
		const copy = copyRef.current
		if (!container || !copy) return
		function measure() {
			if (!container || !copy) return
			setOverflows(copy.offsetWidth > container.clientWidth)
		}
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(container)
		return () => observer.disconnect()
	}, [])

	/** Re-arms the copy window whenever the overflow state flips. */
	useEffect(() => {
		const container = containerRef.current
		if (!container) return
		container.scrollLeft = 0
		setWindowStart(0)
		if (overflows) {
			setWindowCount((count) => Math.max(count, MIN_COPIES))
		} else {
			setWindowCount(1)
		}
	}, [overflows])

	/** Distance between two adjacent copies — one copy's width plus the gap. */
	function period(): number {
		const row = rowRef.current
		const first = row?.firstElementChild
		const second = first?.nextElementSibling
		if (row && first && second) {
			const gap =
				second.getBoundingClientRect().left - first.getBoundingClientRect().left
			if (gap > 0) return gap
		}
		const copy = copyRef.current
		return copy ? copy.offsetWidth + GAP : 0
	}

	/** Card left edges (scroll positions) across all rendered copies. */
	function boundaries(): number[] {
		const container = containerRef.current
		const row = rowRef.current
		if (!container || !row) return []
		const containerRect = container.getBoundingClientRect()
		const at = container.scrollLeft
		const edges: number[] = []
		for (const copy of row.children) {
			for (const child of copy.children) {
				edges.push(child.getBoundingClientRect().left - containerRect.left + at)
			}
		}
		return edges
	}

	/** Width of the last card in the window (identical in every copy). */
	function lastCardWidth(): number {
		const bounds = boundaries()
		if (bounds.length >= 2) return bounds.at(-1)! - bounds.at(-2)! - GAP
		const row = rowRef.current
		const lastChild = row?.lastElementChild?.lastElementChild
		return lastChild?.getBoundingClientRect().width ?? 0
	}

	/** Grows or slides the copy window so at least one full copy sits fully
	    off-screen on each side of the viewport. Never visible: any shift is
	    compensated on `scrollLeft` in the same frame (layout effect), so the
	    pixels never move. Skipped while a step animates. */
	function enforceWindow() {
		const container = containerRef.current
		if (!container || windowChangeQueuedRef.current) return
		const p = period()
		if (p <= 0) return
		let start = windowStartRef.current
		let count = windowCountRef.current
		let shift = 0
		const s = container.scrollLeft
		const w = container.clientWidth
		// The head copy must end before the viewport starts: extend left.
		if (s < p) {
			start -= 1
			count += 1
			shift += p
		}
		let scrolled = s + shift
		// The tail copy must start after the viewport ends: extend right.
		while (count < MAX_COPIES * 2 && (count - 1) * p < scrolled + w) {
			count += 1
		}
		// Slide the window: drop copies fully outside the viewport.
		while (count > MIN_COPIES && scrolled >= 2 * p) {
			start += 1
			count -= 1
			shift -= p
			scrolled -= p
		}
		while (count > MIN_COPIES && (count - 2) * p >= scrolled + w) {
			count -= 1
		}
		if (start === windowStartRef.current && count === windowCountRef.current)
			return
		windowChangeQueuedRef.current = true
		windowStartRef.current = start
		windowCountRef.current = count
		shiftRef.current += shift
		setWindowStart(start)
		setWindowCount(count)
	}

	function scrollTo(left: number) {
		const container = containerRef.current
		if (!container) return
		steppingRef.current = true
		container.scrollTo({
			left,
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		})
		setTimeout(() => {
			steppingRef.current = false
		}, STEP_MS + 200)
	}

	/** Glide to a card edge — deferred until the pending window change
	    commits, with the target adjusted by the same shift. */
	function glideTo(target: number) {
		if (windowChangeQueuedRef.current) {
			pendingScrollRef.current = target + shiftRef.current
		} else {
			scrollTo(target)
		}
	}

	/** Step one card forward (or backward). The window grows on demand, so a
	    step never wraps — it keeps moving in the same direction. */
	function step(direction: 1 | -1) {
		const container = containerRef.current
		if (!container) return
		enforceWindow()
		const at = container.scrollLeft
		const bounds = boundaries()
		if (direction === 1) {
			const next = bounds.find((boundary) => boundary > at + 1)
			if (next !== undefined) {
				glideTo(next)
				return
			}
			// Nothing rendered ahead: land on the first card of a fresh copy.
			pendingScrollRef.current =
				(bounds.at(-1) ?? at) + lastCardWidth() + GAP + shiftRef.current
			return
		}
		const previous = bounds.filter((boundary) => boundary < at - 1).at(-1)
		if (previous !== undefined) {
			glideTo(previous)
			return
		}
		// Nothing before: a prepended copy places the previous card one
		// copy-width ahead; the shift keeps the pixels still.
		pendingScrollRef.current = shiftRef.current - lastCardWidth() - GAP
	}

	/** Manual step: move now, then leave the user alone for a while. */
	function stepManually(direction: 1 | -1) {
		pausedUntilRef.current = Date.now() + MANUAL_PAUSE_MS
		step(direction)
	}

	useImperativeHandle(ref, () => ({ step: stepManually }))

	/** Applies a queued window shift in the same frame the DOM updates, then
	    fires any deferred step target. */
	useLayoutEffect(() => {
		windowChangeQueuedRef.current = false
		windowStartRef.current = windowStart
		windowCountRef.current = windowCount
		const container = containerRef.current
		const shift = shiftRef.current
		shiftRef.current = 0
		if (!container) return
		if (shift !== 0) container.scrollLeft += shift
		if (pendingScrollRef.current !== null) {
			scrollTo(pendingScrollRef.current)
			pendingScrollRef.current = null
		}
	}, [windowStart, windowCount])

	/** Keeps the window alive on manual scrolling — a gesture approaching
	    either edge finds fresh room instead of hitting an end. */
	useEffect(() => {
		if (!overflows) return
		const container = containerRef.current
		if (!container) return
		function handleScroll() {
			if (!container || steppingRef.current) return
			enforceWindow()
		}
		container.addEventListener("scroll", handleScroll)
		return () => container.removeEventListener("scroll", handleScroll)
	}, [overflows])

	/** Auto-step — suspended while hovered or after a manual chevron
	    press. */
	useEffect(() => {
		if (!overflows || items.length < 2) return
		const id = setInterval(() => {
			if (hoveringRef.current || Date.now() < pausedUntilRef.current) return
			if (prefersReducedMotion()) return
			step(1)
		}, intervalMs)
		return () => clearInterval(id)
	}, [overflows, intervalMs, items.length])

	/** Vertical wheel scrolls the strip horizontally; native horizontal
	    deltas (trackpads) pass through untouched. Either way the window is
	    extended first so the gesture never runs out of room. */
	useEffect(() => {
		if (!overflows) return
		const container = containerRef.current
		if (!container) return
		function handleWheel(event: WheelEvent) {
			if (!container) return
			if (!steppingRef.current) enforceWindow()
			if (event.deltaX !== 0 || event.deltaY === 0) return
			event.preventDefault()
			container.scrollLeft += event.deltaY
		}
		container.addEventListener("wheel", handleWheel, { passive: false })
		return () => container.removeEventListener("wheel", handleWheel)
	}, [overflows])

	return (
		<div
			className={cn("relative", className)}
			onMouseEnter={() => {
				hoveringRef.current = true
			}}
			onMouseLeave={() => {
				hoveringRef.current = false
			}}
		>
			<div ref={containerRef} className="no-scrollbar overflow-x-auto pb-2">
				<div ref={rowRef} className="flex w-max gap-4">
					{Array.from({ length: windowCount }, (_, i) => (
						<div
							key={windowStart + i}
							ref={i === 0 ? copyRef : undefined}
							className="flex gap-4"
							aria-hidden={i > 0}
						>
							{items}
						</div>
					))}
				</div>
			</div>
		</div>
	)
})
