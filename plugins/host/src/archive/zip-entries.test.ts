import { execSync } from "node:child_process"
import {
	closeSync,
	openSync,
	truncateSync,
	unlinkSync,
	writeSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { readFileRange } from "./zip-entries.ts"

const INT32_MAX = 2_147_483_647

describe("readFileRange", () => {
	const paths: string[] = []

	afterEach(() => {
		for (const path of paths.splice(0)) {
			try {
				unlinkSync(path)
			} catch {
				// already removed
			}
		}
	})

	// Generous timeout: without the sparse flag, the positional write past
	// the 2 GiB mark makes NTFS zero-fill the gap synchronously.
	test("reads bytes beyond the Int32 position limit", {
		timeout: 120_000,
	}, async () => {
		const path = join(tmpdir(), `hoard-read-range-${Date.now()}.bin`)
		paths.push(path)
		const fd = openSync(path, "w")
		closeSync(fd)
		if (process.platform === "win32") {
			// Skip the ~2 GiB zero-fill NTFS would otherwise write on the
			// positional write below. Best effort — fsutil needs elevation,
			// and the plain write still works (slowly) without it.
			try {
				execSync(`fsutil sparse setflag "${path}"`)
			} catch {
				// fall back to the slow fill
			}
		}
		truncateSync(path, INT32_MAX + 64)
		const rw = openSync(path, "r+")
		writeSync(rw, Buffer.from("0123456789"), 0, 10, INT32_MAX + 1)
		closeSync(rw)

		const buf = await readFileRange(path, INT32_MAX + 1, INT32_MAX + 10)
		expect(buf.toString("utf8")).toBe("0123456789")
	})
})
