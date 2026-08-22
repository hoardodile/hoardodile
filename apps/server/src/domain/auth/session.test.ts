import { beforeEach, describe, expect, test } from "vitest"
import { createSessionStore, type SessionStore } from "./session.ts"

const TEST_PASSWORD = "app-test-session-password-32+chars-required!"

describe("session store (iron-session)", () => {
	let store: SessionStore
	beforeEach(() => {
		store = createSessionStore({ password: TEST_PASSWORD })
	})

	test("create then read returns the same session", async () => {
		const issued = await store.create(60, 1_000)
		const got = await store.read(issued.sealed, 1_000)
		expect(got?.id).toBe(issued.session.id)
		expect(got?.expiresAt).toBe(1_000 + 60_000)
	})

	test("read returns undefined after the session expires", async () => {
		const issued = await store.create(1, 1_000)
		expect(await store.read(issued.sealed, 1_500)).toBeDefined()
		expect(await store.read(issued.sealed, 2_000)).toBeUndefined()
		expect(await store.read(issued.sealed, 5_000)).toBeUndefined()
	})

	test("read returns undefined for a missing or tampered cookie", async () => {
		expect(await store.read(undefined, 1_000)).toBeUndefined()
		expect(await store.read("", 1_000)).toBeUndefined()
		expect(await store.read("not-a-real-seal", 1_000)).toBeUndefined()
	})

	test("read rejects cookies sealed with a different password", async () => {
		const other = createSessionStore({
			password: "another-completely-different-32+char-secret!!",
		})
		const issued = await other.create(60, 1_000)
		expect(await store.read(issued.sealed, 1_000)).toBeUndefined()
	})

	test("touch leaves the cookie alone when more than half the TTL remains", async () => {
		const issued = await store.create(60, 1_000)
		const refreshed = await store.touch(issued.sealed, 60, 1_000 + 1_000)
		expect(refreshed?.session.expiresAt).toBe(issued.session.expiresAt)
		expect(refreshed?.sealed).toBeUndefined()
	})

	test("touch re-seals once more than half the TTL has elapsed", async () => {
		const issued = await store.create(60, 1_000)
		const cutoff = 1_000 + 31_000
		const refreshed = await store.touch(issued.sealed, 60, cutoff)
		expect(refreshed?.session.expiresAt).toBe(cutoff + 60_000)
		expect(refreshed?.session.expiresAt).toBeGreaterThan(
			issued.session.expiresAt,
		)
		expect(refreshed?.sealed).toBeDefined()
		expect(refreshed?.sealed).not.toBe(issued.sealed)
	})

	test("touch returns undefined for a missing or expired session", async () => {
		const issued = await store.create(1, 1_000)
		expect(await store.touch(undefined, 60, 1_000)).toBeUndefined()
		expect(await store.touch("ghost", 60, 1_000)).toBeUndefined()
		expect(await store.touch(issued.sealed, 60, 1_000 + 2_000)).toBeUndefined()
	})

	test("rotate issues a fresh session unrelated to any prior cookie", async () => {
		const prev = await store.create(60, 1_000)
		const next = await store.rotate(60, 1_000)
		expect(next.session.id).not.toBe(prev.session.id)
		expect(next.sealed).not.toBe(prev.sealed)
		expect(await store.read(next.sealed, 1_000)).toBeDefined()
	})

	test("createSessionStore rejects passwords shorter than 32 chars", () => {
		expect(() => createSessionStore({ password: "too-short" })).toThrow(
			/at least 32/,
		)
	})

	test("createToken round-trips through verifyToken with its resId", async () => {
		const token = await store.createToken(86_400, "res-1", 1_000)
		const verified = await store.verifyToken(token.sealed, 1_000)
		expect(verified).toBeDefined()
		expect(verified?.resId).toBe("res-1")
	})

	test("createToken produces four dot-separated parts", async () => {
		const token = await store.createToken(86_400, "res-1", 1_000)
		const parts = token.sealed.split(".")
		expect(parts.length).toBe(4)
		expect(parts[0]!.length).toBeGreaterThanOrEqual(8)
		expect(parts[3]!.length).toBeGreaterThanOrEqual(8)
	})

	test("verifyToken rejects unknown tokens", async () => {
		expect(await store.verifyToken("not-a-real-tkn", 1_000)).toBeUndefined()
	})

	test("verifyToken rejects tampered tokens", async () => {
		const token = await store.createToken(86_400, "res-1", 1_000)
		const parts = token.sealed.split(".")
		const sig = parts[3]!
		// Flip the first signature char to one that is guaranteed different —
		// a fixed replacement is a no-op whenever the random HMAC happens to
		// start with it (~1/64), which made this test flaky.
		const flipped = sig.startsWith("x") ? "y" : "x"
		const tampered = `${parts[0]!}.${parts[1]!}.${parts[2]!}.${flipped}${sig.slice(1)}`
		expect(await store.verifyToken(tampered, 1_000)).toBeUndefined()
	})

	test("verifyToken rejects tokens with a swapped resId", async () => {
		const token = await store.createToken(86_400, "res-1", 1_000)
		const parts = token.sealed.split(".")
		const swapped = `${parts[0]!}.${parts[1]!}.res-2.${parts[3]!}`
		expect(await store.verifyToken(swapped, 1_000)).toBeUndefined()
	})

	test("verifyToken rejects legacy three-part tokens", async () => {
		const token = await store.createToken(86_400, "res-1", 1_000)
		const parts = token.sealed.split(".")
		const legacy = `${parts[0]!}.${parts[1]!}.${parts[3]!}`
		expect(await store.verifyToken(legacy, 1_000)).toBeUndefined()
	})

	test("verifyToken rejects expired tokens", async () => {
		const token = await store.createToken(1, "res-1", 1_000)
		expect(await store.verifyToken(token.sealed, 1_000 + 2_000)).toBeUndefined()
	})
})
