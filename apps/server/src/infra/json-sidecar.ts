import {
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs"

/**
 * Read and parse a JSON file. Returns `undefined` when the file is
 * missing or malformed — sidecars are always best-effort.
 */
export function readJsonFile(path: string): unknown {
	if (!existsSync(path)) return undefined
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as unknown
	} catch {
		return undefined
	}
}

/**
 * Write `value` as JSON to `path` atomically (`.writing-*` sibling +
 * rename) so a reader never observes a partial file. On failure the
 * temporary file is removed and the error rethrown.
 */
export function atomicWriteJsonSync(path: string, value: unknown): void {
	const tmp = `${path}.writing-${process.pid}-${Date.now()}`
	try {
		writeFileSync(tmp, JSON.stringify(value), { encoding: "utf8" })
		renameSync(tmp, path)
	} catch (err) {
		rmSync(tmp, { force: true })
		throw err
	}
}

/**
 * Validator for one optional sidecar field: maps a raw JSON value to the
 * field's canonical form, or `undefined` when the value is absent or
 * invalid (empty strings included).
 */
export type SidecarField<T> = (raw: unknown) => T | undefined

export type SidecarSchema<T> = {
	readonly [K in keyof T]: SidecarField<T[K]>
}

/**
 * Create a JSON sidecar reader/writer pair bound to one schema. Used for
 * the small metadata files that travel next to a primary artifact (e.g.
 * `backup.sqlite.meta.json`). Both halves share one canonicalisation
 * rule: fields are validated by the schema's validators, dropped when
 * invalid, and the file itself is deleted once nothing valid remains so
 * stale sidecars never outlive their content.
 */
export function createSidecar<T extends Record<string, unknown>>(
	schema: SidecarSchema<T>,
) {
	/**
	 * Read and validate the sidecar file at `path`. Returns `undefined`
	 * when the file is missing, malformed, or holds no valid fields.
	 */
	function read(path: string): T | undefined {
		const raw = readJsonFile(path) as Record<string, unknown> | undefined
		if (raw === undefined) return undefined
		const out: Partial<T> = {}
		for (const key of Object.keys(schema) as readonly (keyof T)[]) {
			const value = schema[key](raw[key as string])
			if (value !== undefined) out[key] = value
		}
		return Object.keys(out).length > 0 ? (out as T) : undefined
	}

	/**
	 * Persist `meta` to the sidecar file at `path`. Invalid values are
	 * dropped; when nothing remains the file is deleted instead.
	 */
	function write(path: string, meta: T): void {
		const payload: Record<string, unknown> = {}
		for (const key of Object.keys(schema) as readonly (keyof T)[]) {
			const value = meta[key]
			if (value !== undefined) payload[key as string] = value
		}
		if (Object.keys(payload).length === 0) {
			rmSync(path, { force: true })
			return
		}
		atomicWriteJsonSync(path, payload)
	}

	return { read, write }
}

/** Sidecar validator for a non-empty string field. */
export const sidecarString: SidecarField<string> = (raw) =>
	typeof raw === "string" && raw.length > 0 ? raw : undefined

/** Sidecar validator for a number field at or above `min`. */
export function sidecarNumber(min: number): SidecarField<number> {
	return (raw) => (typeof raw === "number" && raw >= min ? raw : undefined)
}
