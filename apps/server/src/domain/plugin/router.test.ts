import type { FastifyRequest } from "fastify"
import { describe, expect, test, vi } from "vitest"
import { buildPluginRouter } from "./router.ts"

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111"
const RES_ID = "res-1"

describe("plugin router previewInitContext", () => {
	function createMocks() {
		const service = {
			listAll: vi.fn(() => []),
			getAssetVersion: vi.fn((id: string) =>
				id === PLUGIN_ID ? "1700000000000" : undefined,
			),
			supportsCapability: vi.fn(() => false),
			update: vi.fn(),
			reorder: vi.fn(),
			rescan: vi.fn(async () => undefined),
			syncRecords: vi.fn(),
			uninstall: vi.fn(async () => undefined),
			listSeedPlugins: vi.fn(() => []),
			restoreSeedPlugin: vi.fn(async () => undefined),
		}
		const usage = {
			countByContentPluginId: vi.fn(() => 0),
		}
		const cleanupPluginData = vi.fn()
		const prefs = {
			listByPlugin: vi.fn(() => [
				{ pluginId: PLUGIN_ID, key: "theme", value: "dark", updatedAt: 1 },
				{ pluginId: PLUGIN_ID, key: "scale", value: "1.5", updatedAt: 1 },
				{ pluginId: PLUGIN_ID, key: "cleared", value: "", updatedAt: 1 },
			]),
		}
		const cache = {
			listForRes: vi.fn(() => [
				{
					pluginId: PLUGIN_ID,
					resId: RES_ID,
					key: "page",
					value: "3",
					updatedAt: 1,
				},
				{
					pluginId: PLUGIN_ID,
					resId: RES_ID,
					key: "stale",
					value: "",
					updatedAt: 1,
				},
			]),
		}
		const sessions = {
			read: vi.fn(async (sealed: string | undefined) =>
				sealed === "valid-cookie" ? { id: "session-1" } : undefined,
			),
			createToken: vi.fn(
				async (
					ttlSeconds: number,
					scope: { readonly kind: "res" | "plugin"; readonly id: string },
				) => ({
					sealed: `token:${ttlSeconds}:${scope.kind}:${scope.id}`,
					expiresAt: 0,
				}),
			),
		}
		return { service, prefs, cache, sessions, usage, cleanupPluginData }
	}

	function createCaller(
		deps: ReturnType<typeof createMocks>,
		opts?: { authenticated?: boolean; cookie?: string },
	) {
		const router = buildPluginRouter({
			...deps,
			cleanupPluginData: deps.cleanupPluginData as never,
		})
		const authenticated = opts?.authenticated ?? true
		const cookies: Record<string, string> = {}
		if (opts?.cookie !== undefined) cookies.hoard_session = opts.cookie
		return router.createCaller({
			authenticated,
			env: { SESSION_COOKIE_NAME: "hoard_session" } as never,
			req: {
				cookies,
				server: { readOnly: false },
			} as unknown as FastifyRequest,
			res: {} as never,
			sessionId: authenticated ? "test" : undefined,
		})
	}

	test("returns collapsed prefs/cache plus file token and asset version", async () => {
		const deps = createMocks()
		const caller = createCaller(deps, { cookie: "valid-cookie" })
		const result = await caller.previewInitContext({
			pluginId: PLUGIN_ID,
			resId: RES_ID,
		})
		expect(result).toEqual({
			prefs: { theme: "dark", scale: "1.5" },
			cache: { page: "3" },
			fileToken: `token:86400:res:${RES_ID}`,
			// The mock registry has no manifest, so no vault token is issued.
			assetToken: "",
			assetVersion: "1700000000000",
		})
		expect(deps.prefs.listByPlugin).toHaveBeenCalledWith(PLUGIN_ID)
		expect(deps.cache.listForRes).toHaveBeenCalledWith(PLUGIN_ID, RES_ID)
		expect(deps.sessions.createToken).toHaveBeenCalledTimes(1)
		expect(deps.service.getAssetVersion).toHaveBeenCalledWith(PLUGIN_ID)
	})

	test("assetVersion is undefined for an unknown plugin", async () => {
		const deps = createMocks()
		const caller = createCaller(deps, { cookie: "valid-cookie" })
		const result = await caller.previewInitContext({
			pluginId: "22222222-2222-4222-8222-222222222222",
			resId: RES_ID,
		})
		expect(result.assetVersion).toBeUndefined()
	})

	test("rejects when the session cookie is missing or invalid", async () => {
		const deps = createMocks()
		const caller = createCaller(deps, { cookie: "bogus" })
		await expect(
			caller.previewInitContext({ pluginId: PLUGIN_ID, resId: RES_ID }),
		).rejects.toThrow("UNAUTHORIZED")
		expect(deps.sessions.createToken).not.toHaveBeenCalled()
	})

	test("unauthenticated caller is rejected", async () => {
		const deps = createMocks()
		const caller = createCaller(deps, {
			authenticated: false,
			cookie: "valid-cookie",
		})
		await expect(
			caller.previewInitContext({ pluginId: PLUGIN_ID, resId: RES_ID }),
		).rejects.toThrow("UNAUTHORIZED")
	})

	test("usageCount reports live resources bound to the plugin", async () => {
		const deps = createMocks()
		deps.usage.countByContentPluginId.mockReturnValue(7)
		const caller = createCaller(deps)
		await expect(caller.usageCount({ id: PLUGIN_ID })).resolves.toBe(7)
		expect(deps.usage.countByContentPluginId).toHaveBeenCalledWith(PLUGIN_ID)
	})

	test("uninstall delegates to the service and cleans up plugin data", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		await caller.uninstall({ id: PLUGIN_ID })
		expect(deps.service.uninstall).toHaveBeenCalledWith(PLUGIN_ID)
		expect(deps.cleanupPluginData).toHaveBeenCalledWith(PLUGIN_ID)
	})

	test("listSeeds delegates to the service", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		await caller.listSeeds()
		expect(deps.service.listSeedPlugins).toHaveBeenCalled()
	})

	test("restoreSeed delegates to the service with the given id", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		await caller.restoreSeed({ id: PLUGIN_ID })
		expect(deps.service.restoreSeedPlugin).toHaveBeenCalledWith(PLUGIN_ID)
	})

	test("restoreSeed rejects a non-uuid id", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		await expect(caller.restoreSeed({ id: "not-a-uuid" })).rejects.toThrow()
		expect(deps.service.restoreSeedPlugin).not.toHaveBeenCalled()
	})
})
