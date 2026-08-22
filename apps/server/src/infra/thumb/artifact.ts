import { stat } from "node:fs/promises"
import { withCacheAndQueue } from "@hoardodile/host/media"
import type { MediaKind } from "@hoardodile/sdk-types/media-exts"
import type { KeyedQueue } from "../queue.ts"
import type { ThumbSource } from "./source.ts"

export type ThumbReady = {
	readonly kind: "ready"
	readonly path: string
	/**
	 * Image format actually written to disk. Defaults to "avif" for
	 * non-animated sources; "webp" when webp was requested or the source
	 * is animated (sharp cannot encode animated AVIF).
	 */
	readonly format: ThumbFormat
}

export type ThumbUnavailable = {
	readonly kind: "unavailable"
	readonly reason: "placeholder" | "custom-pin"
}

export type ThumbResult = ThumbReady | ThumbUnavailable

/** Image encoding: always "avif" unless the source is animated. */
export type ThumbFormat = "webp" | "avif"

/**
 * A declarative artifact render: the cache-first, coalesced, failure-
 * isolated shell every derived image goes through. The job declares
 * where its cache lives (`resolveDest`), where its source comes from
 * (`resolveSource` — `undefined` means "no source", reported as
 * unavailable), and how the source becomes bytes (`render`). All four
 * thumb-service artifacts (cover, file preview, character thumb, video
 * frame) are expressed as jobs.
 */
export type ArtifactJob = {
	readonly queue: KeyedQueue<ThumbResult>
	/** Cache identity: the destination path for each output format. */
	readonly resolveDest: (fmt: ThumbFormat) => string
	/**
	 * Resolve the renderable source; `undefined` (or a throw) surfaces
	 * as `{ kind: "unavailable", reason: "placeholder" }`.
	 */
	readonly resolveSource: () => Promise<ThumbSource | undefined>
	/**
	 * Turn the resolved source into bytes. A throw is caught and mapped
	 * to unavailable; a deliberate {@link ThumbUnavailable} return (e.g.
	 * a kind the job cannot render) flows through unchanged.
	 */
	readonly render: (source: ThumbSource) => Promise<ThumbResult>
}

/**
 * Run an {@link ArtifactJob}: serve the cached artifact when it exists,
 * otherwise coalesce concurrent renders for the same identity onto one
 * job (the queue double-checks the cache inside the task).
 */
export async function renderArtifact(job: ArtifactJob): Promise<ThumbResult> {
	return withCacheAndQueue(
		job.queue,
		() => firstReadyDest(job.resolveDest),
		job.resolveDest("avif"),
		async () => {
			let source: ThumbSource | undefined
			try {
				source = await job.resolveSource()
			} catch {
				return unavailable()
			}
			if (source === undefined) return unavailable()
			try {
				return await job.render(source)
			} catch {
				return unavailable()
			}
		},
	)
}

/**
 * Dispatch a sniffed media kind onto its render handler. The three
 * decodable families each get a handler; anything else (or a kind
 * without a handler) falls back — e.g. `other` files cannot be
 * thumbnailed and report unavailable.
 */
export async function dispatchMediaKind<T>(
	kind: MediaKind,
	handlers: {
		readonly image?: () => Promise<T>
		readonly video?: () => Promise<T>
		readonly audio?: () => Promise<T>
	},
	fallback: () => Promise<T>,
): Promise<T> {
	const handler =
		kind === "image"
			? handlers.image
			: kind === "video"
				? handlers.video
				: kind === "audio"
					? handlers.audio
					: undefined
	if (handler === undefined) return fallback()
	return handler()
}

function unavailable(): ThumbUnavailable {
	return { kind: "unavailable", reason: "placeholder" }
}

/** The first existing destination among the output formats, if any. */
async function firstReadyDest(
	resolveDest: (fmt: ThumbFormat) => string,
): Promise<ThumbReady | undefined> {
	const avifPath = resolveDest("avif")
	if (await fileExists(avifPath)) {
		return { kind: "ready", path: avifPath, format: "avif" }
	}
	const webpPath = resolveDest("webp")
	if (await fileExists(webpPath)) {
		return { kind: "ready", path: webpPath, format: "webp" }
	}
	return undefined
}

async function fileExists(path: string): Promise<boolean> {
	try {
		const info = await stat(path)
		return info.isFile() && info.size > 0
	} catch {
		return false
	}
}
