import { describe, expect, test } from "vitest"
import { toSafeErrorBody } from "./error-response.ts"

describe("toSafeErrorBody", () => {
	test("masks a 500: generic message, no code, no internal path", () => {
		const body = toSafeErrorBody({
			statusCode: 500,
			code: "ENOENT",
			message:
				"ENOENT: no such file or directory, stat '/srv/hoardodile/apps/web/dist/index.html'",
		})
		expect(body.statusCode).toBe(500)
		expect(body.message).toBe("Internal Server Error")
		expect(body.code).toBeUndefined()
		const serialized = JSON.stringify(body)
		expect(serialized).not.toContain("index.html")
		expect(serialized).not.toContain("ENOENT")
		expect(serialized).not.toContain("srv/hoardodile")
	})

	test("preserves a 400 message plus code and validation", () => {
		const body = toSafeErrorBody({
			statusCode: 400,
			code: "FST_ERR_VALIDATION",
			message: "body must have required property 'name'",
			validation: [{ keyword: "required", dataPath: ".body" }],
		})
		expect(body.statusCode).toBe(400)
		expect(body.error).toBe("Bad Request")
		expect(body.message).toBe("body must have required property 'name'")
		expect(body.code).toBe("FST_ERR_VALIDATION")
		expect(body.validation).toEqual([
			{ keyword: "required", dataPath: ".body" },
		])
	})

	test("treats a missing statusCode as a masked 500", () => {
		const body = toSafeErrorBody({
			message: "boom at '/srv/hoardodile/x'",
			code: "ENOENT",
		})
		expect(body.statusCode).toBe(500)
		expect(body.message).toBe("Internal Server Error")
		expect(body.code).toBeUndefined()
	})

	test("carries a custom client-facing 4xx code", () => {
		const body = toSafeErrorBody({
			statusCode: 401,
			code: "SESSION_EXPIRED",
			message: "session expired",
		})
		expect(body.statusCode).toBe(401)
		expect(body.error).toBe("Unauthorized")
		expect(body.code).toBe("SESSION_EXPIRED")
		expect(body.message).toBe("session expired")
	})
})
