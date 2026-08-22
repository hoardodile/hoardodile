/**
 * Prefetch an array of URLs through detached `<img>` elements so the
 * browser HTTP cache is warm. Errors resolve so the run can finish.
 * `onProgress` is called after each URL completes (success or failure).
 */
export async function prefetchImages(
	urls: readonly string[],
	concurrency: number,
	onProgress?: (done: number) => void,
): Promise<void> {
	let cursor = 0
	let done = 0

	async function pump(): Promise<void> {
		for (;;) {
			const i = cursor
			cursor += 1
			if (i >= urls.length) break
			const url = urls[i]
			if (url !== undefined) {
				await new Promise<void>((resolve) => {
					const img = new Image()
					function settle() {
						img.removeEventListener("load", settle)
						img.removeEventListener("error", settle)
						resolve()
					}
					img.addEventListener("load", settle)
					img.addEventListener("error", settle)
					img.src = url
				})
			}
			done += 1
			onProgress?.(done)
		}
	}

	const lanes = Math.min(concurrency, urls.length)
	const runners: Promise<void>[] = []
	for (let i = 0; i < lanes; i += 1) runners.push(pump())
	await Promise.all(runners)
}
