import type { OverlayRegistry } from "@hoardodile/sdk-web"
import { describe, expect, it, vi } from "vitest"
import { createOverlayHost } from "./mobile-overlays"

function setup() {
	const entries = new Map<string, Parameters<OverlayRegistry["set"]>[0]>()
	const send = vi.fn()
	const host = createOverlayHost({
		registry: {
			set: (entry) => {
				entries.set(entry.id, entry)
			},
			remove: (id) => {
				entries.delete(id)
			},
		},
		send,
	})
	return { host, entries, send }
}

describe("host mobile overlays", () => {
	it("registers parent/child identities and sends closes only to the owning frame", () => {
		const { host, entries, send } = setup()
		const source = {}
		const session = host.bind(source, "resource")
		host.sync(source, "resource", {
			session,
			revision: 1,
			overlays: [{ id: "parent" }, { id: "child", parentId: "parent" }],
		})
		const child = entries.get(`${session}/child`)!
		expect(child.parentId).toBe(`${session}/parent`)
		child.close()
		expect(child.isOpen()).toBe(false)
		expect(send).toHaveBeenLastCalledWith(source, {
			type: "push",
			key: "overlayClose",
			data: { session, id: "child" },
		})
		// An unchanged snapshot acknowledges a controlled close refusal.
		host.sync(source, "resource", {
			session,
			revision: 2,
			overlays: [{ id: "parent" }, { id: "child", parentId: "parent" }],
		})
		expect(child.isOpen()).toBe(true)
	})

	it("rejects unbound sources, stale resources, old lifetimes, and out-of-order revisions", () => {
		const { host, entries } = setup()
		const source = {}
		const session = host.bind(source, "one")
		const input = { session, revision: 2, overlays: [{ id: "dialog" }] }
		expect(host.sync({}, "one", input).accepted).toBe(false)
		expect(host.sync(source, "wrong", input).accepted).toBe(false)
		host.sync(source, "one", input)
		host.sync(source, "one", { ...input, revision: 1, overlays: [] })
		expect(entries.size).toBe(1)
		host.release(source)
		expect(entries.size).toBe(0)
		const next = host.bind(source, "one")
		expect(next).not.toBe(session)
		expect(host.sync(source, "one", input).accepted).toBe(false)
		host.bind(source, "two")
		expect(host.sync(source, "one", { ...input, session: next }).accepted).toBe(
			false,
		)
	})

	it("keeps independent frames separate and releases all registrations on disposal", () => {
		const { host, entries } = setup()
		const first = {}
		const second = {}
		for (const source of [first, second]) {
			const session = host.bind(source, "same-resource")
			host.sync(source, "same-resource", {
				session,
				revision: 1,
				overlays: [{ id: "same-id" }],
			})
		}
		expect(entries.size).toBe(2)
		host.release(first)
		expect(entries.size).toBe(1)
		host.dispose()
		expect(entries.size).toBe(0)
	})
})
