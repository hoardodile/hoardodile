import { readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

/** Recursively collect files under `dir` whose name ends with an ext in `exts`. */
export function walkFiles(dir, exts) {
	const out = []
	for (const dirent of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, dirent.name)
		if (dirent.isDirectory()) out.push(...walkFiles(full, exts))
		else if (exts.some((ext) => dirent.name.endsWith(ext))) out.push(full)
	}
	return out
}

/**
 * `rmSync` with retries: killed child processes may hold handles briefly
 * on Windows. Blocks the event loop between attempts — no shell sleep.
 */
export function removeWithRetry(dir, attempts = 20) {
	for (let i = 0; i < attempts; i++) {
		try {
			rmSync(dir, { recursive: true, force: true })
			return
		} catch {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
		}
	}
	rmSync(dir, { recursive: true, force: true })
}
