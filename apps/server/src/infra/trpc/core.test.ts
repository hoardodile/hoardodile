import { describe, expect, test } from "vitest"
import { z } from "zod"
import { router, writeProcedure } from "./core.ts"

const testRouter = router({
	write: writeProcedure
		.input(z.object({ value: z.number() }))
		.mutation(({ input, ctx }) => ({
			value: input.value,
			hasWriteDeps: "writeDeps" in ctx,
		})),
})

type TestContext = {
	authenticated: true
	req: {
		server: {
			db: unknown
			paths: unknown
			readOnly: boolean
		}
	}
}

function makeContext(readOnly: boolean): TestContext {
	return {
		authenticated: true,
		req: {
			server: {
				db: {},
				paths: {},
				readOnly,
			},
		},
	}
}

describe("writeProcedure", () => {
	test("allows mutations when not in read-only mode and injects writeDeps", async () => {
		const caller = testRouter.createCaller(makeContext(false) as never)
		const result = await caller.write({ value: 42 })
		expect(result).toEqual({ value: 42, hasWriteDeps: true })
	})

	test("blocks mutations when the server is in read-only mode", async () => {
		const caller = testRouter.createCaller(makeContext(true) as never)
		await expect(caller.write({ value: 42 })).rejects.toThrow(
			"server is viewing a read-only archive; mutations are blocked",
		)
	})
})
