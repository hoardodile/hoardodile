/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, test, vi } from "vitest"
import {
	clearImageHashesListeners,
	notifyImageHashesReady,
	onImageHashesReady,
} from "./dup-toast"

afterEach(() => {
	clearImageHashesListeners()
})

describe("onImageHashesReady / notifyImageHashesReady", () => {
	test("notifies once per matching resource and unsubscribes itself", () => {
		const notify = vi.fn()
		onImageHashesReady("res-1", notify)
		onImageHashesReady("res-2", notify)

		notifyImageHashesReady("res-1")
		notifyImageHashesReady("res-1")

		expect(notify).toHaveBeenCalledTimes(1)
	})

	test("does not notify other resources", () => {
		const notify = vi.fn()
		onImageHashesReady("res-1", notify)
		notifyImageHashesReady("res-2")
		expect(notify).not.toHaveBeenCalled()
	})

	test("unsubscribe prevents delivery", () => {
		const notify = vi.fn()
		const unsubscribe = onImageHashesReady("res-1", notify)
		unsubscribe()
		notifyImageHashesReady("res-1")
		expect(notify).not.toHaveBeenCalled()
	})
})
