import { useEffect, useState } from "react"

/**
 * Defer mounting an expensive subtree by one animation frame so the
 * surrounding chrome (header, title) paints first instead of waiting on the
 * heavy mount (e.g. the BlockNote editor) to finish blocking the main thread.
 *
 * Returns false until the first animation frame after mount, then true.
 * Pass a `resetKey` to re-defer when the identity changes (e.g. switching
 * documents): the flag flips back to false and waits one frame again.
 */
export function useDeferredMount(resetKey?: unknown) {
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		const frame = requestAnimationFrame(() => setMounted(true))
		return () => {
			cancelAnimationFrame(frame)
			setMounted(false)
		}
	}, [resetKey])

	return mounted
}
