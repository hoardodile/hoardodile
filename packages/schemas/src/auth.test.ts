import { describe, expect, test } from "vitest"
import {
	authStatus,
	changePasswordRequest,
	loginRequest,
	logoutResponse,
	MIN_PASSWORD_LENGTH,
	passwordOpResponse,
	setupRequest,
} from "./auth.ts"

describe("auth schemas", () => {
	test("loginRequest accepts a password", () => {
		expect(loginRequest.parse({ password: "x" }).password).toBe("x")
	})

	test("loginRequest rejects an empty password", () => {
		expect(loginRequest.safeParse({ password: "" }).success).toBe(false)
	})

	test("loginRequest rejects a missing password", () => {
		expect(loginRequest.safeParse({}).success).toBe(false)
	})

	test("setupRequest accepts a password at the minimum length", () => {
		expect(
			setupRequest.parse({ password: "a".repeat(MIN_PASSWORD_LENGTH) })
				.password,
		).toHaveLength(MIN_PASSWORD_LENGTH)
	})

	test("setupRequest rejects a password below the minimum length", () => {
		expect(
			setupRequest.safeParse({ password: "a".repeat(MIN_PASSWORD_LENGTH - 1) })
				.success,
		).toBe(false)
	})

	test("changePasswordRequest requires both passwords and a long enough new one", () => {
		expect(
			changePasswordRequest.parse({
				currentPassword: "old",
				newPassword: "a".repeat(MIN_PASSWORD_LENGTH),
			}).newPassword,
		).toHaveLength(MIN_PASSWORD_LENGTH)
		expect(
			changePasswordRequest.safeParse({
				currentPassword: "old",
				newPassword: "x",
			}).success,
		).toBe(false)
		expect(
			changePasswordRequest.safeParse({ currentPassword: "old" }).success,
		).toBe(false)
	})

	test("authStatus round-trips both flags", () => {
		expect(
			authStatus.parse({ authenticated: true, configured: true }).authenticated,
		).toBe(true)
		expect(
			authStatus.parse({ authenticated: false, configured: false }).configured,
		).toBe(false)
		expect(authStatus.safeParse({ authenticated: false }).success).toBe(false)
	})

	test("logoutResponse only accepts ok: true", () => {
		expect(logoutResponse.parse({ ok: true }).ok).toBe(true)
		expect(logoutResponse.safeParse({ ok: false }).success).toBe(false)
	})

	test("passwordOpResponse only accepts ok: true", () => {
		expect(passwordOpResponse.parse({ ok: true }).ok).toBe(true)
		expect(passwordOpResponse.safeParse({ ok: false }).success).toBe(false)
	})
})
