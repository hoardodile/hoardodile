import type {
	ChangePasswordRequest,
	LoginRequest,
	LogoutResponse,
	PasswordOpResponse,
	SetupRequest,
} from "@hoardodile/schemas"
import {
	authStatus,
	logoutResponse,
	passwordOpResponse,
} from "@hoardodile/schemas"
import { queryOptions } from "@tanstack/react-query"
import { z } from "zod"
import { HttpError, jsonFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"

const authStatusResponse = authStatus.extend({
	demoPassword: z.boolean().optional(),
})

export async function fetchAuthStatus() {
	const body = await jsonFetch(apiPaths.auth.status(), { method: "GET" })
	return authStatusResponse.parse(body)
}

/**
 * Claim an unconfigured server with the first admin password. Only
 * accepted while the server has no password set; afterwards the caller
 * signs in with {@link login}.
 */
export async function setup(
	payload: SetupRequest,
): Promise<PasswordOpResponse> {
	const body = await jsonFetch(apiPaths.auth.setup(), {
		method: "POST",
		body: JSON.stringify(payload),
	})
	return passwordOpResponse.parse(body)
}

export async function login(payload: LoginRequest) {
	const body = await jsonFetch(apiPaths.auth.login(), {
		method: "POST",
		body: JSON.stringify(payload),
	})
	return authStatus.parse(body)
}

/**
 * Change the admin password. Requires a valid session and proof of the
 * current password; existing sessions stay valid.
 */
export async function changePassword(
	payload: ChangePasswordRequest,
): Promise<PasswordOpResponse> {
	const body = await jsonFetch(apiPaths.auth.password(), {
		method: "POST",
		body: JSON.stringify(payload),
	})
	return passwordOpResponse.parse(body)
}

export async function logout(): Promise<LogoutResponse> {
	try {
		const body = await jsonFetch(apiPaths.auth.logout(), {
			method: "POST",
			body: JSON.stringify({}),
		})
		return logoutResponse.parse(body)
	} catch (err) {
		// Logout is idempotent: a 404 (route missing on an older server)
		// or 401 (session already expired) means the user is already
		// effectively logged out, so we surface success rather than
		// blocking the UI on a stale-server detail.
		if (
			err instanceof HttpError &&
			(err.status === 404 || err.status === 401)
		) {
			return { ok: true } as const
		}
		throw err
	}
}

export { HttpError }

export const authKeys = {
	all: ["auth"] as const,
	status: () => [...authKeys.all, "status"] as const,
}

const AUTH_STATUS_STALE_MS = 30_000

export function authStatusQueryOptions() {
	return queryOptions({
		queryKey: authKeys.status(),
		queryFn: () => fetchAuthStatus(),
		staleTime: AUTH_STATUS_STALE_MS,
	})
}

export const authStatusQueryKey = authKeys.status()
