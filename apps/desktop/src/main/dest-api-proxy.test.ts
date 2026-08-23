/**
 * @vitest-environment node
 */

import { net } from "electron"
import { describe, expect, it, vi } from "vitest"
import {
	destApiProxyTarget,
	destSpaNeedsSidecarProxy,
	proxyHttpRequest,
} from "./dest-api-proxy.ts"

vi.mock("electron", () => ({
	net: { fetch: vi.fn() },
	session: {
		defaultSession: {
			protocol: { handle: vi.fn() },
		},
	},
}))

const spa = "http://127.0.0.1:5173"
const sidecar = "http://127.0.0.1:4123/"

describe("destApiProxyTarget", () => {
	it("rewrites Vite-origin API paths onto the sidecar", () => {
		expect(destApiProxyTarget(`${spa}/trpc`, spa, sidecar)).toBe(
			"http://127.0.0.1:4123/trpc",
		)
		expect(
			destApiProxyTarget(`${spa}/trpc/resource.importConfig`, spa, sidecar),
		).toBe("http://127.0.0.1:4123/trpc/resource.importConfig")
		expect(destApiProxyTarget(`${spa}/auth/login`, spa, sidecar)).toBe(
			"http://127.0.0.1:4123/auth/login",
		)
		expect(
			destApiProxyTarget(
				`${spa}/api/resources/x/cover?size=thumb`,
				spa,
				sidecar,
			),
		).toBe("http://127.0.0.1:4123/api/resources/x/cover?size=thumb")
		expect(destApiProxyTarget(`${spa}/health`, spa, sidecar)).toBe(
			"http://127.0.0.1:4123/health",
		)
	})

	it("leaves Vite assets and non-API paths on the SPA origin", () => {
		expect(destApiProxyTarget(`${spa}/`, spa, sidecar)).toBeUndefined()
		expect(
			destApiProxyTarget(`${spa}/@vite/client`, spa, sidecar),
		).toBeUndefined()
		expect(
			destApiProxyTarget(`${spa}/authenticate`, spa, sidecar),
		).toBeUndefined()
	})

	it("does not rewrite sidecar-origin or privileged internal routes", () => {
		expect(
			destApiProxyTarget("http://127.0.0.1:4123/trpc", spa, sidecar),
		).toBeUndefined()
		expect(
			destApiProxyTarget(`${spa}/api/internal/shared-folder`, spa, sidecar),
		).toBeUndefined()
		expect(
			destApiProxyTarget(`${spa}/api/internal`, spa, sidecar),
		).toBeUndefined()
	})
})

describe("destSpaNeedsSidecarProxy", () => {
	it("is true when Vite and the sidecar are different origins", () => {
		expect(destSpaNeedsSidecarProxy(spa, sidecar)).toBe(true)
	})

	it("is false when the SPA is already the sidecar", () => {
		expect(destSpaNeedsSidecarProxy(sidecar, sidecar)).toBe(false)
	})
})

describe("proxyHttpRequest", () => {
	it("passes non-API requests through untouched", async () => {
		const passthrough = new Response("vite", { status: 200 })
		vi.mocked(net.fetch).mockResolvedValueOnce(passthrough)
		const res = await proxyHttpRequest(
			new Request(`${spa}/@vite/client`),
			spa,
			sidecar,
		)
		expect(res).toBe(passthrough)
		expect(net.fetch).toHaveBeenCalledWith(
			expect.any(Request),
			expect.objectContaining({ bypassCustomProtocolHandlers: true }),
		)
	})

	it("forwards SPA-origin API paths onto the sidecar", async () => {
		const forwarded = new Response("json", { status: 200 })
		const fetchMock = vi.mocked(net.fetch)
		fetchMock.mockClear()
		fetchMock.mockResolvedValueOnce(forwarded)
		const res = await proxyHttpRequest(
			new Request(`${spa}/trpc/x`),
			spa,
			sidecar,
		)
		expect(res).toBe(forwarded)
		const [target] = fetchMock.mock.calls[0] as [Request]
		expect(target.url).toBe("http://127.0.0.1:4123/trpc/x")
	})

	it("fails the request when the passthrough target is unreachable (main-frame refresh)", async () => {
		vi.mocked(net.fetch).mockRejectedValueOnce(
			new Error("net::ERR_CONNECTION_REFUSED"),
		)
		const res = await proxyHttpRequest(
			new Request(`${spa}/settings/desktop`),
			spa,
			sidecar,
		)
		// Network-level failure (ERR_FAILED in the protocol handler), never
		// an error-status body: the shell's did-fail-load path must swap in
		// the in-window error page instead of painting a raw 502 body.
		expect(res.type).toBe("error")
		expect(res.ok).toBe(false)
	})

	it("resolves 502 when the forward is refused (sidecar restart gap)", async () => {
		vi.mocked(net.fetch).mockRejectedValueOnce(
			new Error("net::ERR_CONNECTION_REFUSED"),
		)
		const res = await proxyHttpRequest(
			new Request(`${spa}/trpc/x`),
			spa,
			sidecar,
		)
		expect(res.status).toBe(502)
	})
})
