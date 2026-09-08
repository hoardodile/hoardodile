import { describe, expect, it, vi } from "vitest"
import { createIframeOverlayRegistry } from "./mobile-overlays.ts"
import type { Host, HostPushes } from "./protocol.ts"

function setup() {
	const listeners = new Map<string, (message: unknown) => void>()
	const request = vi.fn().mockResolvedValue({ accepted: true })
	const host: Host = {
		request,
		subscribe(key, handler) {
			listeners.set(key, (message) => handler(message as never))
			return () => {
				listeners.delete(key)
			}
		},
		withScope: () => host,
	}
	const registry = createIframeOverlayRegistry(host)
	function push<K extends keyof HostPushes>(key: K, message: HostPushes[K]) {
		listeners.get(key)?.(message)
	}
	return { registry, request, listeners, push }
}

describe("iframe mobile overlays", () => {
	it("coalesces StrictMode registration and preserves actual parent identities", async () => {
		const { registry, request } = setup()
		registry.configure({ resId: "resource", overlaySession: "session" })
		registry.set({
			id: "child",
			parentId: "parent",
			isOpen: () => true,
			close: vi.fn(),
		})
		registry.set({ id: "parent", isOpen: () => true, close: vi.fn() })
		registry.remove("parent")
		registry.set({ id: "parent", isOpen: () => true, close: vi.fn() })
		await Promise.resolve()
		const payload = request.mock.calls.at(-1)?.[1]
		expect(payload).toMatchObject({
			session: "session",
			overlays: [{ parentId: "parent:2" }, { id: "parent:2" }],
		})
	})

	it("acknowledges closes, rejects old activation messages, and supports reopen", async () => {
		const { registry, request, push } = setup()
		registry.configure({ resId: "resource", overlaySession: "session" })
		let open = true
		const close = vi.fn(() => {
			open = false
		})
		const item = { id: "dialog", isOpen: () => open, close }
		registry.set(item)
		await Promise.resolve()
		push("overlayClose", { session: "session", id: "dialog:1" })
		await Promise.resolve()
		expect(open).toBe(false)
		expect(request).toHaveBeenLastCalledWith(
			"overlaySync",
			expect.objectContaining({ overlays: [] }),
		)
		open = true
		registry.set(item)
		await Promise.resolve()
		push("overlayClose", { session: "session", id: "dialog:1" })
		expect(close).toHaveBeenCalledTimes(1)
		push("overlayClose", { session: "session", id: "dialog:2" })
		expect(close).toHaveBeenCalledTimes(2)
	})

	it("retains registrations through visibility changes but clears them on release/rebind", async () => {
		const { registry, push, request } = setup()
		registry.configure({ resId: "one", overlaySession: "old" })
		const close = vi.fn()
		registry.set({ id: "dialog", isOpen: () => true, close })
		await Promise.resolve()
		push("visibility", { visible: false })
		expect(close).not.toHaveBeenCalled()
		push("overlaySession", { resId: "one" })
		expect(close).toHaveBeenCalledTimes(1)
		registry.configure({ resId: "two", overlaySession: "new" })
		await Promise.resolve()
		expect(request).toHaveBeenLastCalledWith(
			"overlaySync",
			expect.objectContaining({ session: "new", overlays: [] }),
		)
		push("overlayClose", { session: "old", id: "dialog:1" })
		expect(close).toHaveBeenCalledTimes(1)
	})

	it("degrades without a host capability and removes message listeners on disposal", async () => {
		const { registry, request, listeners } = setup()
		registry.configure({ resId: "old-host" })
		registry.set({ id: "dialog", isOpen: () => true, close: vi.fn() })
		await Promise.resolve()
		expect(request).not.toHaveBeenCalled()
		registry.dispose()
		expect(listeners.size).toBe(0)
	})
})
