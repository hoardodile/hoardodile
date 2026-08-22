/**
 * @vitest-environment node
 */

import { QueryClient } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { authStatusQueryKey } from "@/features/auth"
import { performSignOut, subscribeAuthLogout } from "./privacySignOut"

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	})
}

describe("privacySignOut", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("clears the session cookie and wipes the query cache", async () => {
		const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })))
		vi.stubGlobal("fetch", fetchMock)
		const queryClient = new QueryClient()
		queryClient.setQueryData(authStatusQueryKey, {
			authenticated: true,
			configured: true,
		})
		queryClient.setQueryData(["resource", "list"], { items: ["secret"] })

		await performSignOut(queryClient)

		expect(fetchMock).toHaveBeenCalledWith(
			"/auth/logout",
			expect.objectContaining({ method: "POST" }),
		)
		// Every cached query is dropped...
		expect(queryClient.getQueryData(["resource", "list"])).toBeUndefined()
		// ...and only the unauthenticated auth status survives, carrying
		// the last known `configured` so /login picks the right form.
		expect(queryClient.getQueryData(authStatusQueryKey)).toEqual({
			authenticated: false,
			configured: true,
		})
	})

	it("signs out locally even when the server is unreachable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => Promise.reject(new Error("down"))),
		)
		const queryClient = new QueryClient()
		queryClient.setQueryData(authStatusQueryKey, {
			authenticated: true,
			configured: false,
		})
		queryClient.setQueryData(["resource", "list"], { items: ["secret"] })

		await expect(performSignOut(queryClient)).resolves.toBeUndefined()
		expect(queryClient.getQueryData(["resource", "list"])).toBeUndefined()
		expect(queryClient.getQueryData(authStatusQueryKey)).toEqual({
			authenticated: false,
			configured: false,
		})
	})

	it("broadcasts the logout to other tabs and delivers it to subscribers", async () => {
		// The module keeps a private singleton channel; a peer channel
		// represents another tab. Messages posted by the peer must reach
		// the module's listener.
		const peer = new BroadcastChannel("hoardodile-auth")
		const listener = vi.fn()
		const unsubscribe = subscribeAuthLogout(listener)

		peer.postMessage({ type: "logout" })

		await vi.waitFor(() => {
			expect(listener).toHaveBeenCalledTimes(1)
		})
		unsubscribe()
	})
})
