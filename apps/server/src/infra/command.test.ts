import { describe, expect, test } from "vitest"
import { runWrite } from "./command.ts"

describe("runWrite", () => {
	test("throws DomainError when readOnly is true", async () => {
		await expect(
			runWrite(
				{
					db: {} as unknown as Parameters<typeof runWrite>[0]["db"],
					paths: {} as unknown as Parameters<typeof runWrite>[0]["paths"],
					readOnly: true,
				},
				async () => "should not run",
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			kind: "server.read_only_archive",
			message: "write operations are blocked",
		})
	})

	test("executes command and returns result when readOnly is false", async () => {
		const result = await runWrite(
			{
				db: {} as unknown as Parameters<typeof runWrite>[0]["db"],
				paths: {} as unknown as Parameters<typeof runWrite>[0]["paths"],
				readOnly: false,
			},
			async () => "ok",
		)
		expect(result).toBe("ok")
	})

	test("accepts synchronous commands", async () => {
		const result = await runWrite(
			{
				db: {} as unknown as Parameters<typeof runWrite>[0]["db"],
				paths: {} as unknown as Parameters<typeof runWrite>[0]["paths"],
				readOnly: false,
			},
			() => 42,
		)
		expect(result).toBe(42)
	})
})
