import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Test components that render `@hoardodile/ui` strings use the
// `renderWithI18n` helper (see `./i18n.ts`) — it wraps the tree in an
// I18nProvider bound to the shared test instance.

// jsdom does not implement matchMedia; stub it deterministically so
// media-query code paths (use-mobile, useMobileBackToClose) have
// something to consult during tests.
if (typeof window !== "undefined") {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false,
		}),
	})

	// jsdom does not implement ResizeObserver; stub it so virtual list
	// libraries can measure the scroll container during tests.
	class StubResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}

	Object.defineProperty(window, "ResizeObserver", {
		writable: true,
		configurable: true,
		value: StubResizeObserver,
	})

	// jsdom does not implement IntersectionObserver; stub it so lazy-loading
	// sentinel elements do not crash tests.
	class StubIntersectionObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	}

	Object.defineProperty(window, "IntersectionObserver", {
		writable: true,
		configurable: true,
		value: StubIntersectionObserver,
	})

	Object.defineProperty(window, "scrollTo", {
		writable: true,
		configurable: true,
		value: () => undefined,
	})

	Object.defineProperty(Element.prototype, "scrollTo", {
		writable: true,
		configurable: true,
		value: () => undefined,
	})
}

// jsdom does not implement HTMLCanvasElement#getContext; the image
// cropping pipeline consults it during tests. Return a no-op 2D context
// so cropper components can mount without noisy "canvas npm package"
// warnings.
if (typeof HTMLCanvasElement !== "undefined") {
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
		writable: true,
		configurable: true,
		value: (contextId: string) => {
			if (contextId !== "2d") return null
			const noOp = () => undefined
			return new Proxy(
				{},
				{
					get(_target, prop) {
						if (prop === "canvas") return null
						if (prop === "getContextAttributes") return () => ({})
						if (prop === "measureText") return () => ({ width: 0 })
						if (prop === "getImageData") return () => ({ data: [] })
						if (prop === "createImageData")
							return () => ({ data: [], width: 0, height: 0 })
						if (prop === "isPointInPath") return () => false
						if (prop === "isPointInStroke") return () => false
						return noOp
					},
				},
			) as unknown as CanvasRenderingContext2D
		},
	})
}

afterEach(() => {
	cleanup()
	if (typeof localStorage !== "undefined") localStorage.clear()
})
