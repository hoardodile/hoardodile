import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/**
 * Persistent marker store of deliberately-uninstalled bundled (seed)
 * plugins. One id per removed plugin, persisted as JSON at
 * `local/seed-removals.json` — host-only state that survives restarts
 * and app updates, so boot-time seeding never resurrects an official
 * plugin the user removed (until they restore it from the marketplace's
 * bundled-plugins section).
 *
 * Reads are lazy and best-effort (missing/corrupt file → empty set);
 * writes are write-through and synchronous, and a failed persist
 * propagates — an uninstall that cannot record its removal must fail
 * rather than let the plugin silently come back on the next restart.
 */
export type SeedRemovalsStore = {
	read(): ReadonlySet<string>
	add(id: string): void
	remove(id: string): void
}

export function createSeedRemovalsStore(file: string): SeedRemovalsStore {
	let loaded = false
	const ids = new Set<string>()

	function load(): void {
		if (loaded) return
		loaded = true
		try {
			const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"))
			if (typeof parsed !== "object" || parsed === null) return
			const removed = (parsed as { readonly removed?: unknown }).removed
			if (!Array.isArray(removed)) return
			for (const entry of removed) {
				if (typeof entry === "string" && entry.length > 0) {
					ids.add(entry)
				}
			}
		} catch {
			// Missing or corrupt marker — start empty.
		}
	}

	function persist(): void {
		mkdirSync(dirname(file), { recursive: true })
		writeFileSync(
			file,
			JSON.stringify({ version: 1, removed: [...ids] }, null, "\t"),
		)
	}

	return {
		read() {
			load()
			return ids
		},
		add(id) {
			load()
			ids.add(id)
			persist()
		},
		remove(id) {
			load()
			ids.delete(id)
			persist()
		},
	}
}
