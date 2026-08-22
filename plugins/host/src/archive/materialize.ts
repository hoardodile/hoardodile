import { createWriteStream } from "node:fs"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

/**
 * Materialization primitives shared by every code path that writes
 * derived files into the extraction cache: the host's container
 * extractor and the server's artifact view (thumb/probe materialization
 * for both literal and virtual entries). One partial+rename+size-check
 * recipe and one single-flight guard, instead of a copy per caller.
 */

/**
 * Write `openStream`'s bytes to `target` atomically: stream to a
 * `.partial` sibling, verify the written size matches `expectedSize`,
 * then rename into place. On any failure the partial is removed and the
 * error rethrown. An already-correct `target` is left untouched.
 *
 * With `key` set, concurrent calls for the same key share one in-flight
 * write instead of racing it (via {@link globalMaterializeInflight}).
 */
export async function materializeFile(opts: {
	readonly openStream: () => Readable | Promise<Readable>
	readonly target: string
	readonly expectedSize: number
	readonly key?: string
}): Promise<void> {
	const { key } = opts
	if (key !== undefined) {
		return withSingleFlight(key, () => materializeFileWithoutFlight(opts))
	}
	return materializeFileWithoutFlight(opts)
}

async function materializeFileWithoutFlight(opts: {
	readonly openStream: () => Readable | Promise<Readable>
	readonly target: string
	readonly expectedSize: number
}): Promise<void> {
	const { openStream, target, expectedSize } = opts
	await mkdir(dirname(target), { recursive: true })
	const partial = `${target}.partial-${process.pid}-${Date.now()}`
	try {
		if (expectedSize === 0) {
			await writeFile(partial, Buffer.alloc(0))
		} else {
			await pipeline(await openStream(), createWriteStream(partial))
		}
		const written = await stat(partial)
		if (written.size !== expectedSize) {
			throw new Error(
				`materialized ${target} size mismatch: expected ${expectedSize}, got ${written.size}`,
			)
		}
		await rename(partial, target)
	} catch (err) {
		await rm(partial, { force: true }).catch(() => {})
		throw err
	}
}

/**
 * Deduplicate concurrent materialization of the same `key`: the second
 * caller awaits the first's in-flight work instead of racing it. The
 * inflight map is shared via {@link globalMaterializeInflight} unless a
 * custom one is passed, matching how the server's artifact views share
 * one guard process-wide.
 */
export function withSingleFlight<T>(
	key: string,
	run: () => Promise<T>,
	inflight: Map<string, Promise<unknown>> = globalMaterializeInflight,
): Promise<T> {
	const pending = inflight.get(key) as Promise<T> | undefined
	if (pending !== undefined) return pending
	const work = run()
	inflight.set(key, work)
	void work.then(
		() => inflight.delete(key),
		() => inflight.delete(key),
	)
	return work
}

/** Process-wide single-flight guard for materialization (host + server). */
export const globalMaterializeInflight = new Map<string, Promise<unknown>>()
