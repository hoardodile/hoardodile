import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { acquireStorageInstance } from "./instance-lock.ts"

it("excludes another writer and releases ownership without stale lock cleanup", () => {
	const root = mkdtempSync(join(tmpdir(), "hd-instance-lock-"))
	const release = acquireStorageInstance(root)
	try {
		expect(() => acquireStorageInstance(root)).toThrow("Another service")
		release()
		const next = acquireStorageInstance(root)
		next()
	} finally {
		release()
		rmSync(root, { recursive: true, force: true })
	}
})
