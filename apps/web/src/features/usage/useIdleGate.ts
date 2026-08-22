import { useEffect, useState } from "react"

export const USAGE_IDLE_TIMEOUT_MS = 5 * 60 * 1000

const ACTIVITY_EVENTS = [
	"pointerdown",
	"keydown",
	"scroll",
	"touchstart",
] as const

/**
 * Returns true when the user has been idle longer than `timeoutMs`.
 */
export function useIdleGate(
	timeoutMs: number = USAGE_IDLE_TIMEOUT_MS,
): boolean {
	const [idle, setIdle] = useState(false)

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined

		function resetIdleTimer(): void {
			setIdle(false)
			if (timer !== undefined) {
				clearTimeout(timer)
			}
			timer = setTimeout(() => {
				setIdle(true)
			}, timeoutMs)
		}

		for (const event of ACTIVITY_EVENTS) {
			window.addEventListener(event, resetIdleTimer, { passive: true })
		}
		resetIdleTimer()

		return () => {
			if (timer !== undefined) {
				clearTimeout(timer)
			}
			for (const event of ACTIVITY_EVENTS) {
				window.removeEventListener(event, resetIdleTimer)
			}
		}
	}, [timeoutMs])

	return idle
}
