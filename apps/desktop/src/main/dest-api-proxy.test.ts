/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from "vitest"
import {
	destApiProxyTarget,
	destSpaNeedsSidecarProxy,
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
