import type {
	PluginAssetDeleteResult,
	PluginDownloadResult,
} from "@hoardodile/sdk-types"
import type { FastifyRequest } from "fastify"
import { describe, expect, test, vi } from "vitest"
import { buildPluginAssetRouter } from "./asset-router.ts"
import type { PluginAssetService } from "./asset-service.ts"
import type { ConsentBroker } from "./consent.ts"

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111"

const RESULT: PluginDownloadResult = {
	path: "runtime.mjs",
	sizeBytes: 5,
	sha256: "a".repeat(64),
	cached: false,
}

function createCaller(opts?: { readOnly?: boolean }) {
	const service: PluginAssetService = {
		requestDownloads: vi.fn(async () => [RESULT]),
		requestDownload: vi.fn(async () => RESULT),
		statAsset: vi.fn(async () => undefined),
		readAsset: vi.fn(async () => new Uint8Array()),
		deleteAsset: vi.fn(
			async () => ({ existed: true }) as PluginAssetDeleteResult,
		),
	}
	const consent: ConsentBroker = {
		request: vi.fn(async () => ({ approved: true })),
		decide: vi.fn(),
		listPending: vi.fn(() => []),
		dispose: vi.fn(),
	}
	const router = buildPluginAssetRouter({ service, consent })
	const caller = router.createCaller({
		authenticated: true,
		req: {
			server: { readOnly: opts?.readOnly ?? false },
		} as unknown as FastifyRequest,
	} as never)
	return { caller, service, consent }
}

describe("pluginAsset router", () => {
	test("request forwards the batch to the service", async () => {
		const { caller, service } = createCaller()
		await expect(
			caller.request({
				pluginId: PLUGIN_ID,
				items: [
					{
						url: "https://example.com/runtime.mjs",
						dest: "runtime.mjs",
					},
				],
			}),
		).resolves.toEqual([RESULT])
		expect(service.requestDownloads).toHaveBeenCalledWith(PLUGIN_ID, [
			{
				url: "https://example.com/runtime.mjs",
				dest: "runtime.mjs",
			},
		])
	})

	test("request rejects an empty batch", async () => {
		const { caller, service } = createCaller()
		await expect(
			caller.request({ pluginId: PLUGIN_ID, items: [] }),
		).rejects.toBeDefined()
		expect(service.requestDownloads).not.toHaveBeenCalled()
	})

	test("delete forwards path and deleteAsset", async () => {
		const { caller, service } = createCaller()
		await expect(
			caller.delete({ pluginId: PLUGIN_ID, path: "runtime.mjs" }),
		).resolves.toEqual({ existed: true })
		expect(service.deleteAsset).toHaveBeenCalledWith(PLUGIN_ID, "runtime.mjs")
	})

	test("decide records remember", async () => {
		const { caller, consent } = createCaller()
		await caller.decide({ ticketId: "t-1", approved: true, remember: true })
		expect(consent.decide).toHaveBeenCalledWith("t-1", true, true)
	})

	test("listPending reads the broker", async () => {
		const { caller, consent } = createCaller()
		await expect(caller.listPending()).resolves.toEqual([])
		expect(consent.listPending).toHaveBeenCalled()
	})
})
