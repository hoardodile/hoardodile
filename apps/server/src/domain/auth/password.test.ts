import { expect, test } from "vitest"
import { hashPassword, verifyPassword } from "./password.ts"

test("hashPassword produces an argon2id hash string", async () => {
	const h = await hashPassword("correct horse battery staple")
	expect(h).toMatch(/^\$argon2id\$/)
})

test("verifyPassword accepts the same password", async () => {
	const h = await hashPassword("hunter2")
	expect(await verifyPassword(h, "hunter2")).toBe(true)
})

test("verifyPassword rejects the wrong password", async () => {
	const h = await hashPassword("hunter2")
	expect(await verifyPassword(h, "hunter3")).toBe(false)
})

test("verifyPassword returns false on malformed hash", async () => {
	expect(await verifyPassword("not-a-hash", "hunter2")).toBe(false)
})
