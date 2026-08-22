import type { FastifyRequest } from "fastify"
import { describe, expect, test, vi } from "vitest"
import { buildVersionRouter } from "./router.ts"

describe("version router", () => {
	function createMocks() {
		const service = {
			list: vi.fn(() => [
				{ version: 1, current: true, active: true, dbSize: 100 },
			]),
			current: vi.fn(() => 1),
			active: vi.fn(() => 1),
			create: vi.fn(() => ({ previous: 1, created: 2 })),
			switchTo: vi.fn(),
			updateMeta: vi.fn(),
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
		const router = buildVersionRouter(deps)
		return router.createCaller({
			authenticated,
			env: {} as never,
			req: mockReq(),
			res: {} as never,
			sessionId: authenticated ? "test" : undefined,
		})
	}

	test("list returns service result", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		const result = await caller.list()
		expect(result).toEqual([
			{ version: 1, current: true, active: true, dbSize: 100 },
		])
		expect(deps.service.list).toHaveBeenCalledTimes(1)
	})

	test("current returns service result", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		const result = await caller.current()
		expect(result).toBe(1)
		expect(deps.service.current).toHaveBeenCalledTimes(1)
	})

	test("active returns service result", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		const result = await caller.active()
		expect(result).toBe(1)
		expect(deps.service.active).toHaveBeenCalledTimes(1)
	})

	test("create calls service and emits version.changed", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		const result = await caller.create({ confirmArchive: true })
		expect(result).toEqual({ previous: 1, created: 2, willRestart: false })
		expect(deps.service.create).toHaveBeenCalledTimes(1)
		expect(deps.signals.emit).toHaveBeenCalledWith("version.changed", undefined)
	})

	test("switchTo calls service and emits version.changed", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		const result = await caller.switchTo({ version: 1 })
		expect(result).toEqual({ version: 1, willRestart: false })
		expect(deps.service.switchTo).toHaveBeenCalledWith(1)
		expect(deps.signals.emit).toHaveBeenCalledWith("version.changed", undefined)
	})

	test("unauthenticated caller is rejected", async () => {
		const deps = createMocks()
		const caller = createCaller(deps, false)
		await expect(caller.list()).rejects.toThrow("UNAUTHORIZED")
	})

	test("create rejects missing confirmArchive", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		// @ts-expect-error intentionally missing required literal
		await expect(caller.create({})).rejects.toThrow()
	})

	test("switchTo rejects invalid version", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		await expect(caller.switchTo({ version: 0 })).rejects.toThrow()
		await expect(caller.switchTo({ version: -1 })).rejects.toThrow()
		await expect(caller.switchTo({ version: 1.5 })).rejects.toThrow()
	})

	test("updateMeta accepts an empty name to clear it", async () => {
		const deps = createMocks()
		const caller = createCaller(deps)
		await caller.updateMeta({ version: 1, name: "" })
		expect(deps.service.updateMeta).toHaveBeenCalledWith(1, { name: "" })
	})
})
