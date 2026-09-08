import { describe, expect, it, vi } from "vitest"
import { createBackHistory } from "../test/back-history"
import {
	createMobileBackController,
	MOBILE_BACK_KEY,
} from "./mobile-back-controller"

function setup() {
	const browser = createBackHistory()
	const controller = createMobileBackController({
		driver: browser.driver,
		schedule: browser.schedule,
		enabled: true,
	})
	const navigations = vi.fn()
	controller.subscribe(navigations)
	function overlay(id: string, parentId?: string) {
		let open = true
		const close = vi.fn(() => {
			open = false
		})
		const entry = { id, parentId, isOpen: () => open, close }
		controller.set(entry)
		return {
			close,
			get open() {
				return open
			},
			set(value: boolean) {
				open = value
				controller.set(entry)
			},
		}
	}
	return { browser, controller, navigations, overlay }
}

describe("mobile back controller", () => {
	it("drops a late blocker result after a newer explicit navigation", async () => {
		const { browser, controller } = setup()
		controller.navigate({ href: "/two", state: null }, false)
		await browser.settle()
		let decide: ((blocked: boolean) => void) | undefined
		controller.setBlocker(
			() =>
				new Promise<boolean>((resolve) => {
					decide = resolve
				}),
		)
		controller.go(-1)
		await browser.settle()
		expect(controller.snapshot.pending).toBe(true)
		controller.navigate({ href: "/newest", state: null }, false)
		await browser.settle()
		decide?.(false)
		await browser.settle()
		expect(controller.location.href).toBe("/newest")
		expect(browser.driver.read().href).toBe("/newest")
		expect(controller.snapshot.pending).toBe(false)
	})
	it("keeps child-first back order when a lower ancestor is reopened underneath it", async () => {
		const { browser, controller, overlay } = setup()
		const parent = overlay("parent")
		const child = overlay("child", "parent")
		await browser.settle()
		parent.set(false)
		await browser.settle()
		parent.set(true)
		await browser.settle()
		controller.go(-1)
		await browser.settle()
		expect(child.open).toBe(false)
		expect(parent.open).toBe(true)
		controller.go(-1)
		await browser.settle()
		expect(parent.open).toBe(false)
		expect(browser.index).toBe(1)
	})
	it("does not resurrect a replaced route through its old forward overlay entries", async () => {
		const { browser, controller, overlay, navigations } = setup()
		overlay("old")
		await browser.settle()
		controller.navigate({ href: "/replacement", state: { key: "new" } }, true)
		await browser.settle()
		controller.go(1)
		await browser.settle()
		expect(controller.location.href).toBe("/replacement")
		expect(browser.driver.read().href).toBe("/replacement")
		expect(navigations).not.toHaveBeenCalled()
	})

	it("distinguishes two real entries having the same URL", async () => {
		const { browser, controller, navigations } = setup()
		controller.navigate(
			{ href: "/page?x=1#part", state: { key: "second" } },
			false,
		)
		await browser.settle()
		controller.go(-1)
		await browser.settle()
		expect(controller.location.state).toEqual({ key: "page" })
		expect(navigations).toHaveBeenCalledTimes(1)
	})

	it("completes route navigation arriving during UI-close cleanup", async () => {
		const { browser, controller, overlay } = setup()
		const item = overlay("item")
		await browser.settle()
		item.set(false)
		await browser.tick()
		controller.navigate({ href: "/next", state: null }, false)
		await browser.settle()
		expect(controller.location.href).toBe("/next")
		expect(browser.index).toBe(2)
		controller.go(-1)
		await browser.settle()
		expect(controller.location.href).toBe("/page?x=1#part")
	})

	it("handles two back traversals queued before either pop is delivered", async () => {
		const { browser, controller, overlay } = setup()
		const parent = overlay("parent")
		const child = overlay("child", "parent")
		await browser.settle()
		controller.go(-1)
		controller.go(-1)
		await browser.settle()
		expect(child.close).toHaveBeenCalledTimes(1)
		expect(parent.close).toHaveBeenCalledTimes(1)
		expect(browser.index).toBe(1)
	})

	it("cleans an unmounted parent without closing an independent upper overlay", async () => {
		const { browser, controller, overlay } = setup()
		overlay("parent")
		const child = overlay("child", "parent")
		await browser.settle()
		controller.remove("parent")
		await browser.settle()
		expect(child.open).toBe(true)
		controller.go(-1)
		await browser.settle()
		expect(child.open).toBe(false)
		expect(browser.index).toBe(1)
	})

	it("preserves null and primitive route state across overlay lifetimes", async () => {
		for (const state of [null, 42, "state", [1, 2]]) {
			const browser = createBackHistory([{ href: "/page", state }])
			const controller = createMobileBackController({
				driver: browser.driver,
				schedule: browser.schedule,
				enabled: true,
			})
			let open = true
			controller.set({
				id: "overlay",
				isOpen: () => open,
				close: () => {
					open = false
				},
			})
			await browser.settle()
			controller.go(-1)
			await browser.settle()
			expect(controller.location.state).toEqual(state)
			expect(controller.location.href).toBe("/page")
			controller.dispose()
		}
	})

	it("recognizes history on reload without matching a fresh overlay to an old activation", async () => {
		const { browser, controller, overlay } = setup()
		overlay("same-id")
		await browser.settle()
		controller.dispose()
		const fresh = createMobileBackController({
			driver: browser.driver,
			schedule: browser.schedule,
			enabled: true,
		})
		let open = true
		fresh.set({
			id: "same-id",
			isOpen: () => open,
			close: () => {
				open = false
			},
		})
		await browser.settle()
		fresh.go(-1)
		await browser.settle()
		expect(open).toBe(false)
		expect(browser.index).toBe(1)
		fresh.dispose()
	})

	it("does not interpret an unknown or malformed marker as an owned entry", async () => {
		const { browser, controller, navigations } = setup()
		controller.navigate({ href: "/next", state: null }, false)
		await browser.settle()
		browser.entries[1] = {
			href: "/foreign",
			state: { [MOBILE_BACK_KEY]: { version: 90 }, __appMobileOverlay: 1 },
		}
		controller.go(-1)
		await browser.settle()
		expect(controller.location.href).toBe("/foreign")
		expect(navigations).toHaveBeenCalledTimes(1)
		expect(controller.snapshot.pending).toBe(false)
	})
	it("orders initially-open actual ancestors before children regardless of registration order", async () => {
		const { browser, controller, overlay, navigations } = setup()
		const child = overlay("child", "parent")
		const parent = overlay("parent")
		await browser.settle()
		expect(browser.index).toBe(3)
		controller.go(-1)
		await browser.settle()
		expect(child.open).toBe(false)
		expect(parent.open).toBe(true)
		expect(controller.location.href).toBe("/page?x=1#part")
		expect(navigations).not.toHaveBeenCalled()
		controller.go(-1)
		await browser.settle()
		expect(parent.open).toBe(false)
		expect(browser.index).toBe(1)
		controller.go(-1)
		await browser.settle()
		expect(controller.location.href).toBe("/before")
		expect(navigations).toHaveBeenCalledTimes(1)
	})

	it("supports back-close/reopen loops without accumulating back presses", async () => {
		const { browser, controller, overlay } = setup()
		const item = overlay("item")
		for (let i = 0; i < 25; i++) {
			item.set(true)
			await browser.settle()
			controller.go(-1)
			await browser.settle()
			expect(item.open).toBe(false)
			expect(browser.index).toBe(1)
			expect(browser.entries).toHaveLength(3)
			expect(controller.snapshot.pending).toBe(false)
		}
		controller.remove("item")
		await browser.settle()
		expect(controller.snapshot.registrations).toBe(0)
		controller.dispose()
		expect(browser.listeners).toBe(0)
	})

	it.each(["lower", "middle"])(
		"keeps the top open when the %s layer closes",
		async (removed) => {
			const { browser, controller, overlay } = setup()
			const lower = overlay("lower")
			const middle = overlay("middle", "lower")
			const top = overlay("top", "middle")
			await browser.settle()
			;(removed === "lower" ? lower : middle).set(false)
			await browser.settle()
			expect(top.open).toBe(true)
			controller.go(-1)
			await browser.settle()
			expect(top.open).toBe(false)
			expect((removed === "lower" ? middle : lower).open).toBe(true)
			controller.go(-1)
			await browser.settle()
			expect(lower.open || middle.open).toBe(false)
			expect(browser.index).toBe(1)
		},
	)

	it("coalesces menu-to-dialog replacement and StrictMode remove/set", async () => {
		const { browser, controller, overlay } = setup()
		const menu = overlay("menu")
		await browser.settle()
		menu.set(false)
		const dialog = overlay("dialog")
		controller.remove("dialog")
		dialog.set(true)
		await browser.settle()
		expect(browser.index).toBe(2)
		expect(dialog.open).toBe(true)
		expect(menu.close).not.toHaveBeenCalled()
		controller.go(-1)
		await browser.settle()
		expect(dialog.close).toHaveBeenCalledTimes(1)
		expect(browser.index).toBe(1)
	})

	it("does not let an in-flight UI-close traversal erase an immediate reopen", async () => {
		const { browser, controller, overlay } = setup()
		const item = overlay("item")
		await browser.settle()
		item.set(false)
		await browser.tick() // reconcile starts an asynchronous traversal
		expect(controller.snapshot.pending).toBe(true)
		item.set(true)
		await browser.settle()
		expect(item.open).toBe(true)
		expect(browser.index).toBe(2)
		controller.go(-1)
		await browser.settle()
		expect(item.close).toHaveBeenCalledTimes(1)
	})

	it.each([false, true])(
		"drains overlay entries before a route write (replace=%s)",
		async (replace) => {
			const { browser, controller, overlay } = setup()
			const item = overlay("item")
			await browser.settle()
			controller.navigate(
				{ href: "/next?q=2#new", state: { key: "next", data: 7 } },
				replace,
			)
			await browser.settle()
			expect(item.open).toBe(false)
			expect(controller.location).toEqual({
				href: "/next?q=2#new",
				state: { key: "next", data: 7 },
			})
			controller.go(-1)
			await browser.settle()
			expect(controller.location.href).toBe(
				replace ? "/before" : "/page?x=1#part",
			)
		},
	)

	it("does not bounce backward or reopen an overlay when forward reaches a tombstone tail", async () => {
		const { browser, controller, overlay, navigations } = setup()
		const item = overlay("item")
		await browser.settle()
		item.set(false)
		await browser.settle()
		controller.go(1)
		await browser.settle()
		expect(item.open).toBe(false)
		expect(browser.index).toBe(2)
		expect(navigations).not.toHaveBeenCalled()
		expect(controller.snapshot.pending).toBe(false)
		controller.go(-1)
		await browser.settle()
		expect(controller.location.href).toBe("/before")
	})

	it("closes all crossed layers on go(-2), without a route navigation", async () => {
		const { browser, controller, overlay, navigations } = setup()
		const a = overlay("a")
		const b = overlay("b", "a")
		await browser.settle()
		controller.go(-2)
		await browser.settle()
		expect(a.open || b.open).toBe(false)
		expect(browser.index).toBe(1)
		expect(navigations).not.toHaveBeenCalled()
	})

	it("rearms a controlled overlay that refuses to close", async () => {
		const { browser, controller } = setup()
		const close = vi.fn()
		controller.set({ id: "refused", isOpen: () => true, close })
		await browser.settle()
		controller.go(-1)
		await browser.settle()
		expect(close).toHaveBeenCalledTimes(1)
		expect(browser.index).toBe(2)
		expect(controller.snapshot.overlays).toHaveLength(1)
	})

	it("reacts to mobile breakpoint changes without closing the visible UI", async () => {
		const { browser, controller, overlay } = setup()
		const item = overlay("item")
		await browser.settle()
		controller.setEnabled(false)
		await browser.settle()
		expect(browser.index).toBe(1)
		expect(item.open).toBe(true)
		controller.setEnabled(true)
		await browser.settle()
		expect(browser.index).toBe(2)
		controller.go(-1)
		await browser.settle()
		expect(item.open).toBe(false)
	})

	it("ignores duplicate pops and permits out-of-range traversal without getting stuck", async () => {
		const { browser, controller, overlay } = setup()
		const item = overlay("item")
		await browser.settle()
		browser.emit()
		controller.go(50)
		await browser.settle()
		expect(item.close).not.toHaveBeenCalled()
		expect(controller.snapshot.pending).toBe(false)
	})

	it("recovers from a denied history write on the next registration change", async () => {
		const { browser, controller, overlay } = setup()
		browser.failWrites(true)
		const item = overlay("item")
		await browser.settle()
		expect(item.open).toBe(true)
		expect(browser.index).toBe(1)
		browser.failWrites(false)
		item.set(true)
		await browser.settle()
		expect(browser.index).toBe(2)
		expect(controller.snapshot.pending).toBe(false)
		expect(browser.entries[2]?.state).toHaveProperty(MOBILE_BACK_KEY)
	})
})
