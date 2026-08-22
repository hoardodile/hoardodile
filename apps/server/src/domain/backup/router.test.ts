import type { FastifyRequest } from "fastify"
import { describe, expect, test, vi } from "vitest"
import { buildBackupRouter } from "./router.ts"

describe("backup router", () => {
	function createMocks() {
		const service = {
			list: vi.fn(async () => []),
			create: vi.fn(async () => ({
				fileName: "app-1.sqlite",
				kind: "manual" as const,
				size: 100,
				createdAt: 1,
				activeVersion: 1,
			})),
			createAuto: vi.fn(async () => ({
				fileName: "auto-1.sqlite",
				kind: "auto" as const,
				size: 100,
				createdAt: 1,
				activeVersion: 1,
			})),
			pruneAuto: vi.fn(async () => undefined),
			getAutoStatus: vi.fn(async () => ({
				enabled: true,
				keep: 3,
				lastAt: 1,
			})),
			delete: vi.fn(async () => undefined),
			prepareRestore: vi.fn(async () => undefined),
			updateMeta: vi.fn(async () => undefined),
			resolveFilePath: vi.fn(async () => "/tmp/app-1.sqlite"),
			snapshotRuntimeDb: vi.fn(async () => undefined),
		}
		const signals = {
			emit: vi.fn(),
			on: vi.fn(() => () => {}),
		}
		return { service, signals }
	}

	function mockReq(readOnly = false): FastifyRequest {
		return { server: { readOnly } } as unknown as FastifyRequest
	}

	function createCaller(
		deps: ReturnType<typeof createMocks>,
		authenticated = true,
	) {
		const router = buildBackupRouter(deps)
		return router.createCaller({
			authenticated,
			env: {} as never,
			req: mockReq(),
			res: {} as never,
			sessionId: authenticated ? "test" : undefined,
		})
	}

	test("updateMeta accepts an empty name to clear it", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		await caller.updateMeta({ fileName: "app-1.sqlite", name: "" })
		expect(deps.service.updateMeta).toHaveBeenCalledWith("app-1.sqlite", {
			name: "",
		})
	})

	test("unauthenticated caller is rejected", async () => {
		const deps = createMocks()
		const caller = createCaller(deps, false)
		await expect(caller.list()).rejects.toThrow("UNAUTHORIZED")
	})
})
