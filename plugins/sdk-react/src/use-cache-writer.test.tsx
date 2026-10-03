import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { useCacheWriter } from "./use-cache-writer"

const fixture = vi.hoisted(() => ({
	setCache: vi.fn(),
	listeners: new Set<() => void>(),
	visible: true,
}))
vi.mock("./context.tsx", () => ({
	usePluginAPI: () => ({ setCache: fixture.setCache }),
}))
vi.mock("@hoardodile/sdk-web", () => ({
	getVisibilitySnapshot: () => fixture.visible,
	subscribeToVisibility: (listener: () => void) => {
		fixture.listeners.add(listener)
		return () => fixture.listeners.delete(listener)
	},
}))

describe("cache writer before iframe destruction", () => {
	it("flushes the latest value when the host hides the resource", () => {
		const encode = (value: number) => String(value)
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
		const container = document.createElement("div")
		document.body.appendChild(container)
		const root = createRoot(container)
		function Harness({ value }: { value: number }) {
			useCacheWriter({ key: "position", value, encode })
			return null
		}
		act(() => root.render(createElement(Harness, { value: 1 })))
		act(() => root.render(createElement(Harness, { value: 3 })))
		fixture.setCache.mockClear()
		act(() => {
			fixture.visible = false
			for (const listener of fixture.listeners) listener()
		})
		expect(fixture.setCache).toHaveBeenCalledWith("position", "3")
		act(() => root.unmount())
		container.remove()
		expect(fixture.listeners.size).toBe(0)
	})
})
