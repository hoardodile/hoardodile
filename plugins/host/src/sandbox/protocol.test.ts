import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import {
	API_METHOD_NAMES,
	deserializeError,
	HOOK_NAMES,
	LOG_METHOD_NAMES,
	serializeError,
} from "./protocol.ts"

/**
 * worker-entry.mjs is plain JS without access to workspace TS sources, so it
 * keeps its own copies of the hook/API name lists. A drift between the two
 * copies only surfaces at runtime as "unknown API method" RPC failures —
 * this test is the compile-time sync guarantee.
 */
const workerEntrySource = readFileSync(
	fileURLToPath(new URL("./worker-entry.mjs", import.meta.url)),
	"utf-8",
)

/** Extract the double-quoted items of the first `[...]` list after `name`. */
function extractStringList(source: string, name: string): string[] {
	// Anchor on the declaration — the file header mentions the same names.
	const start = source.indexOf(`const ${name}`)
	if (start === -1) throw new Error(`${name} not found in worker-entry.mjs`)
	const open = source.indexOf("[", start)
	const close = source.indexOf("]", open)
	if (open === -1 || close === -1) {
		throw new Error(`${name} list not found in worker-entry.mjs`)
	}
	const out: string[] = []
	for (const m of source.slice(open, close).matchAll(/"([^"]+)"/g)) {
		if (m[1] !== undefined) out.push(m[1])
	}
	return out
}

describe("protocol ↔ worker-entry name lists", () => {
	test("HOOK_NAMES match in contract order", () => {
		expect(extractStringList(workerEntrySource, "HOOK_NAMES")).toEqual([
			...HOOK_NAMES,
		])
	})

	test("API_METHOD_NAMES match in contract order", () => {
		expect(extractStringList(workerEntrySource, "API_METHOD_NAMES")).toEqual([
			...API_METHOD_NAMES,
		])
	})

	test("LOG_METHOD_NAMES match", () => {
		expect(
			extractStringList(workerEntrySource, "LOG_METHOD_NAMES").sort(),
		).toEqual([...LOG_METHOD_NAMES].sort())
	})
})

describe("error code over the sandbox IPC", () => {
	test("the asset vocabulary round-trips via `code` (name restored verbatim)", () => {
		const denied = new Error("declined")
		denied.name = "DENIED"
		const serialized = serializeError(denied)
		expect(serialized.code).toBe("DENIED")
		const restored = deserializeError(serialized)
		expect(restored.name).toBe("DENIED")
		expect(restored.message).toBe("declined")
	})

	test("plain errors carry no code and keep their own name", () => {
		const serialized = serializeError(new TypeError("boom"))
		expect(serialized.code).toBeUndefined()
		expect(deserializeError(serialized).name).toBe("TypeError")
	})

	test("an explicit wire code wins over the legacy name field", () => {
		const restored = deserializeError({
			name: "SomeOldName",
			code: "POLICY",
			message: "nope",
		})
		expect(restored.name).toBe("POLICY")
	})
})
