import { z } from "zod"

/**
 * Minimum length enforced for the single-user admin password. Mirrored by
 * the first-run web setup form and the password-change form; the server
 * rejects anything shorter with a 400.
 */
export const MIN_PASSWORD_LENGTH = 4

/** Body of `POST /auth/login`: a single non-empty password. */
export const loginRequest = z.object({
	password: z.string().min(1),
})

/**
 * Body of `POST /auth/setup`: the first admin password, only accepted
 * while the server has no password configured yet.
 */
export const setupRequest = z.object({
	password: z.string().min(MIN_PASSWORD_LENGTH),
})

/**
 * Body of `POST /auth/password`: the current password (proof of
 * possession) plus the replacement, which must meet the minimum length.
 */
export const changePasswordRequest = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(MIN_PASSWORD_LENGTH),
})

/**
 * Response of `GET /auth/status` and `POST /auth/login`: whether the current
 * request is authenticated by a valid session cookie, and whether the
 * server has an admin password configured at all. `configured: false`
 * means the server is still unclaimed and the web UI must offer the
 * first-run setup form instead of the login form.
 */
export const authStatus = z.object({
	authenticated: z.boolean(),
	configured: z.boolean(),
})

/** Response of `POST /auth/logout`: sentinel acknowledgement. */
export const logoutResponse = z.object({
	ok: z.literal(true),
})

/** Response of `POST /auth/setup` and `POST /auth/password`. */
export const passwordOpResponse = z.object({
	ok: z.literal(true),
})

export type LoginRequest = z.infer<typeof loginRequest>
export type SetupRequest = z.infer<typeof setupRequest>
export type ChangePasswordRequest = z.infer<typeof changePasswordRequest>
export type AuthStatus = z.infer<typeof authStatus>
export type LogoutResponse = z.infer<typeof logoutResponse>
export type PasswordOpResponse = z.infer<typeof passwordOpResponse>
