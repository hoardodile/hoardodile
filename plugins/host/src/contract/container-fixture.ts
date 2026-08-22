import { Readable } from "node:stream"
import type { ResourceContainer } from "../container.ts"

/** Declarative in-memory content for a {@link ResourceContainer}. */
export type ContainerFixtureConfig = {
	/** Entry name → content. Names may contain `/` for nesting. */
	readonly files?: Readonly<Record<string, string | Uint8Array>>
}

/**
 * An in-memory {@link ResourceContainer} driven by a declarative config.
 * The test double in the container contract suite: every assertion runs
 * against it, the directory container and the zip container, and the
 * three must agree.
 */
export function createContainerFixture(
	config: ContainerFixtureConfig = {},
): ResourceContainer {
	const files = config.files ?? {}

	function bytesOf(relPath: string): Uint8Array | undefined {
		const content = files[relPath]
		if (content === undefined) return undefined
		return typeof content === "string"
			? new TextEncoder().encode(content)
			: content
	}

	return {
		async listEntries(): Promise<readonly string[]> {
			return Object.keys(files)
		},

		async readEntry(relPath: string): Promise<Buffer> {
			const bytes = bytesOf(relPath)
			if (bytes === undefined) {
				throw new Error(`fixture container has no entry ${relPath}`)
			}
			return Buffer.from(bytes)
		},

		async readEntrySlice(
			relPath: string,
			start: number,
			end: number,
		): Promise<Buffer> {
			const bytes = bytesOf(relPath)
			if (bytes === undefined) {
				throw new Error(`fixture container has no entry ${relPath}`)
			}
			const clampedStart = Math.min(Math.max(0, start), bytes.length)
			const clampedEnd = Math.min(Math.max(clampedStart, end), bytes.length)
			return Buffer.from(bytes.subarray(clampedStart, clampedEnd))
		},

		async openEntryStream(relPath: string): Promise<{
			readonly stream: Readable
			readonly size: number
		}> {
			const bytes = bytesOf(relPath)
			if (bytes === undefined) {
				throw new Error(`fixture container has no entry ${relPath}`)
			}
			return { stream: Readable.from(bytes), size: bytes.length }
		},

		async resolveByteRange(
			relPath: string,
		): Promise<{ readonly size: number } | undefined> {
			const bytes = bytesOf(relPath)
			return bytes === undefined ? undefined : { size: bytes.length }
		},
	}
}
