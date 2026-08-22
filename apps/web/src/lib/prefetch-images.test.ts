/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prefetchImages } from "./prefetch-images"

type Listener = () => void

/**
 * Minimal stand-in for `Image`: setting `src` asynchronously fires `load`
 * unless the URL contains "bad", in which case it fires `error`.
 */
class MockImage {
	static instances: MockImage[] = []

	private readonly listeners = new Map<string, Set<Listener>>()

	constructor() {
		MockImage.instances.push(this)
	}

	addEventListener(type: string, listener: Listener): void {
		let set = this.listeners.get(type)
		if (set === undefined) {
			set = new Set()
			this.listeners.set(type, set)
		}
		set.add(listener)
	}

	removeEventListener(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener)
	}

	set src(url: string) {
		queueMicrotask(() => {
			const type = url.includes("bad") ? "error" : "load"
			for (const listener of this.listeners.get(type) ?? []) {
				listener()
			}
		})
	}
}

describe("prefetchImages", () => {
	beforeEach(() => {
		MockImage.instances = []
		vi.stubGlobal("Image", MockImage)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("loads every URL and reports progress up to the total", async () => {
		const urls = ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"]
		const progress: number[] = []

		await prefetchImages(urls, 2, (done) => {
			progress.push(done)
		})

		expect(MockImage.instances).toHaveLength(urls.length)
		expect(progress).toEqual([1, 2, 3, 4])
	})

	it("resolves through image errors so the run can finish", async () => {
		const progress: number[] = []

		await prefetchImages(["/bad.jpg", "/ok.jpg"], 2, (done) => {
			progress.push(done)
		})

		expect(progress).toEqual([1, 2])
	})

	it("does nothing for an empty list", async () => {
		const onProgress = vi.fn()
		await prefetchImages([], 6, onProgress)
		expect(MockImage.instances).toHaveLength(0)
		expect(onProgress).not.toHaveBeenCalled()
	})
})
