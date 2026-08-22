import {
	type Character,
	imageSlotHasFile,
	MAX_PAGE_SIZE,
} from "@hoardodile/schemas"

import type { ListPageResult } from "@hoardodile/shared"
import { buildResThumbCacheKey } from "@hoardodile/shared"
import type { CharService } from "src/domain/char/service.ts"
import type { ResService } from "src/domain/res/service.ts"
import type { AdaptiveConcurrency } from "src/infra/adaptive-concurrency.ts"
import type { ThumbService } from "src/infra/thumb/service.ts"

export type PrecacheSweepResult = {
	total: number
	succeeded: number
	failed: number
	errors: Array<{ id: string; error: string }>
	thumbUrls: string[]
}

export type PrecacheResult = {
	readonly resources: PrecacheSweepResult
	readonly characters: PrecacheSweepResult
}

export type PrecacheDeps = {
	readonly res: Pick<ResService, "list" | "rebuildResourceFully">
	readonly chars: Pick<CharService, "list" | "getVariantVersion">
	readonly thumbs: Pick<ThumbService, "getCover" | "getCharacterThumb">
	readonly createConcurrency: () => AdaptiveConcurrency
}

export type PrecacheHooks = {
	readonly onProgress: (
		phase: "resources" | "characters",
		current: number,
		total: number,
	) => void
	readonly isAborted: () => boolean
}

/**
 * Domain-level precache orchestration: sweep all resources (a single-pass
 * full rebuild each) then all characters (avatar + fullbody thumbs),
 * bounded by an adaptive concurrency limiter. Returns `undefined` when
 * aborted mid-run. The HTTP layer (`infra/http/cache-admin.ts`) owns the
 * bus/SSE plumbing and calls this from its fire-and-forget worker.
 */
export async function runPrecache(
	deps: PrecacheDeps,
	hooks: PrecacheHooks,
): Promise<PrecacheResult | undefined> {
	const concurrency = deps.createConcurrency()

	const resources = await sweepAndProcess(
		(page) => deps.res.list({ page, size: MAX_PAGE_SIZE }),
		(item) => rebuildOneResource(deps, item.id),
		(current, total) => hooks.onProgress("resources", current, total),
		concurrency,
		hooks.isAborted,
	)
	if (hooks.isAborted()) return undefined

	const characters = await sweepAndProcess(
		(page) => deps.chars.list({ page, size: MAX_PAGE_SIZE }),
		(item) => renderCharacterThumbs(deps, item),
		(current, total) => hooks.onProgress("characters", current, total),
		concurrency,
		hooks.isAborted,
	)
	if (hooks.isAborted()) return undefined

	return { resources, characters }
}

/**
 * Per-resource precache work: one call into the single-pass rebuild
 * pipeline, then the thumb URL for the client preload list.
 */
async function rebuildOneResource(
	deps: PrecacheDeps,
	id: string,
): Promise<string | undefined> {
	const rebuilt = await deps.res.rebuildResourceFully(id, (resId) =>
		deps.thumbs.getCover(resId),
	)
	if (!rebuilt.coverReady) return undefined
	const v = buildResThumbCacheKey({ updatedAt: rebuilt.updatedAt })
	return `/api/resources/${id}/cover?v=${encodeURIComponent(v)}`
}

async function renderCharacterThumbs(
	deps: PrecacheDeps,
	c: Pick<Character, "id" | "updatedAt" | "imageMeta">,
): Promise<string[]> {
	const urls: string[] = []
	for (const variant of ["avatar", "fullbody"] as const) {
		if (imageSlotHasFile(c.imageMeta?.[variant]) === false) continue
		const ver = await deps.chars.getVariantVersion(c.id, variant)
		const thumb = await deps.thumbs.getCharacterThumb(c.id, variant, ver)
		if (thumb.kind === "ready") {
			urls.push(`/api/characters/${c.id}/thumb/${variant}?v=${c.updatedAt}`)
		}
	}
	return urls
}

/**
 * Generic pager: walk the list endpoint page by page, processing each
 * item under the shared concurrency limiter, collecting thumb URLs and
 * per-item failures without aborting the sweep.
 */
async function sweepAndProcess<T extends { readonly id: string }>(
	loadPage: (page: number) => Promise<ListPageResult<T>>,
	process: (item: T) => Promise<string | string[] | undefined>,
	onProgress: (current: number, total: number) => void,
	concurrency: AdaptiveConcurrency,
	isAborted: () => boolean,
): Promise<PrecacheSweepResult> {
	const result: PrecacheSweepResult = {
		total: 0,
		succeeded: 0,
		failed: 0,
		errors: [],
		thumbUrls: [],
	}
	let processed = 0
	let page = 1
	for (;;) {
		if (isAborted()) break
		const list = await loadPage(page)
		result.total = list.total

		const promises = list.rows.map(async (item) => {
			if (isAborted()) return
			const release = await concurrency.acquire()
			try {
				const urls = await process(item)
				if (urls !== undefined) {
					if (Array.isArray(urls)) result.thumbUrls.push(...urls)
					else result.thumbUrls.push(urls)
				}
				result.succeeded++
			} catch (err) {
				result.failed++
				result.errors.push({
					id: item.id,
					error: err instanceof Error ? err.message : String(err),
				})
			} finally {
				release()
			}
			processed++
			onProgress(processed, list.total)
		})
		await Promise.allSettled(promises)

		if (isAborted()) break
		page++
		if (list.rows.length === 0 || page > 1000) break
	}
	return result
}
