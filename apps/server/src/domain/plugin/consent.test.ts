import { isPluginAssetError } from "@hoardodile/sdk-types"
import { describe, expect, test } from "vitest"
import { type ConsentBrokerDeps, createConsentBroker } from "./consent.ts"

function makeBroker(overrides: Partial<ConsentBrokerDeps> = {}) {
	const requested: { ticketId: string }[] = []
	const resolved: string[] = []
	const broker = createConsentBroker({
		timeoutMs: 50,
		connectionCount: () => 1,
		onRequest: (t) => requested.push(t),
		onResolved: (t) => resolved.push(t),
		...overrides,
	})
	return { broker, requested, resolved }
}

const ticket = {
	pluginId: "p-1",
	pluginName: "Test",
	url: "https://example.com/runtime.mjs",
	dest: "runtime.mjs",
}

describe("createConsentBroker", () => {
	test("request broadcasts and resolve round-trips", async () => {
		const { broker, requested, resolved } = makeBroker()
		const decision = broker.request(ticket)
		expect(requested).toHaveLength(1)
		broker.decide(requested[0]!.ticketId, true, false)
		await expect(decision).resolves.toEqual({ approved: true })
		expect(resolved).toEqual([requested[0]!.ticketId])
	})

	test("timeout auto-denies and broadcasts the resolution", async () => {
		const { broker, requested, resolved } = makeBroker()
		const decision = broker.request(ticket)
		await expect(decision).resolves.toEqual({ approved: false })
		expect(resolved).toEqual([requested[0]!.ticketId])
	})

	test("remember marks the plugin for the session (no dialog)", async () => {
		const { broker, requested } = makeBroker()
		const first = broker.request(ticket)
		const id = requested[0]!.ticketId
		broker.decide(id, true, true)
		await expect(first).resolves.toEqual({ approved: true })
		const second = broker.request(ticket)
		expect(requested).toHaveLength(1)
		await expect(second).resolves.toEqual({ approved: true })
	})

	test("zero connected clients fails fast with UNAVAILABLE", async () => {
		const { broker } = makeBroker({ connectionCount: () => 0 })
		await expect(broker.request(ticket)).rejects.toMatchObject({
			name: "UNAVAILABLE",
		})
	})

	test("per-plugin pending cap rejects extra concurrent tickets", async () => {
		const { broker } = makeBroker({ maxPendingPerPlugin: 1 })
		void broker.request(ticket)
		await expect(broker.request(ticket)).rejects.toMatchObject({
			name: "POLICY",
		})
	})

	test("an unknown ticket id is a no-op; dispose resolves everything", async () => {
		const { broker, resolved } = makeBroker()
		const a = broker.request(ticket)
		const b = broker.request({ ...ticket, dest: "b.mjs" })
		broker.decide("unknown-id", true, false)
		broker.dispose()
		expect(resolved).toHaveLength(2)
		await expect(a).resolves.toEqual({ approved: false })
		await expect(b).resolves.toEqual({ approved: false })
	})

	test("listPending exposes open tickets (reconnect rehydration)", async () => {
		const { broker, requested } = makeBroker()
		void broker.request(ticket)
		expect(broker.listPending()).toEqual([requested[0]])
	})
})

describe("isPluginAssetError across the vocabulary", () => {
	test("matches only the given name", () => {
		const denied = new Error("nope")
		denied.name = "DENIED"
		const policy = new Error("bad")
		policy.name = "POLICY"
		expect(isPluginAssetError(denied, "DENIED")).toBe(true)
		expect(isPluginAssetError(denied, "POLICY")).toBe(false)
		expect(isPluginAssetError(policy, "POLICY")).toBe(true)
		expect(isPluginAssetError("plain", "DENIED")).toBe(false)
	})
})
