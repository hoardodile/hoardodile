import { expect, test, vi } from "vitest"
import { closeWindowWithProtection } from "./window-close.ts"

test("cancelling a close keeps both the window and its credential", async () => {
	const lock = vi.fn()
	const hide = vi.fn()
	const quit = vi.fn()
	await closeWindowWithProtection({
		action: "ask",
		confirm: async () => "cancel",
		lock,
		hide,
		quit,
	})
	expect(lock).not.toHaveBeenCalled()
	expect(hide).not.toHaveBeenCalled()
	expect(quit).not.toHaveBeenCalled()
})

test.each(["tray", "quit"] as const)(
	"accepted %s locks before closing",
	async (action) => {
		const order: string[] = []
		await closeWindowWithProtection({
			action,
			confirm: async () => "cancel",
			lock: async () => {
				order.push("lock")
			},
			hide: () => {
				order.push("tray")
			},
			quit: async () => {
				order.push("quit")
			},
		})
		expect(order).toEqual(["lock", action])
	},
)

test("an accepted confirmation follows the same protection path", async () => {
	const hide = vi.fn()
	await closeWindowWithProtection({
		action: "ask",
		confirm: async () => "tray",
		lock: async () => {},
		hide,
		quit: vi.fn(),
	})
	expect(hide).toHaveBeenCalledOnce()
})
