import { readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import { extname, join } from "node:path"
import { streamStoredZip } from "@hoardodile/host/hoard"
import type { FileStats } from "@hoardodile/schemas"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { runPrecache } from "src/domain/precache/precache.ts"
import { buildResourceAccess } from "src/domain/res/access.ts"
import {
	buildTrashedArtifactView,
	buildTrashedFileList,
	computeTrashedFileStats,
	detectPluginForTrash,
} from "src/domain/res/trash-fallback.ts"
import { createAdaptiveConcurrency } from "src/infra/adaptive-concurrency.ts"
import { assertSafeSegment } from "src/infra/storage/paths.ts"
import { sendFile } from "./conditional-request.ts"
import {
	type PrecacheBus,
	type PrecacheBusEvent,
	precacheBus,
} from "./precache-bus.ts"
import { packViewEntries } from "./res-files.ts"
import { extToContentType, sendError, sendJson } from "./utils.ts"

type TrashItem = {
	readonly name: string
	readonly kind: "resource" | "character" | "db"
	readonly originalId?: string
	readonly trashedAt?: number
	readonly coverUrl?: string
	readonly contentPluginId?: string
	readonly fileStats?: FileStats
	readonly files?: readonly unknown[]
}

function parseTrashEntryName(
	name: string,
): Omit<TrashItem, "coverUrl"> | undefined {
	const resourceMatch = name.match(/^resources-(.+)-(\d+)$/)
	if (resourceMatch !== null) {
		return {
			name,
			kind: "resource",
			originalId: resourceMatch[1],
			trashedAt: Number(resourceMatch[2]),
		}
	}
	const charMatch = name.match(/^characters-(.+)-(\d+)$/)
	if (charMatch !== null) {
		return {
			name,
			kind: "character",
			originalId: charMatch[1],
			trashedAt: Number(charMatch[2]),
		}
	}
	const dbMatch = name.match(/^db-(\d+)$/)
	if (dbMatch !== null) {
		return {
			name,
			kind: "db",
			trashedAt: Number(dbMatch[1]),
		}
	}
	return undefined
}

/**
 * Fastify plugin registering cache-clear and precache routes.
 *
 * `DELETE /api/cache` — wipe everything under `local/cache/` (thumbnail,
 * preview, and extraction caches plus tmp) and all rebuildable metadata
 * in the DB (`resource_meta` columns plus character `image_meta`) — the
 * whole "clear rebuild data" action: everything precache can regenerate.
 * Persistent host-only directories (`local/trash`, `local/logs`,
 * …) are untouched. Installed plugins live under `versions/<v>/plugins`
 * and are not part of the cache. Entries that fail to delete are
 * reported by name in the `failed` array of the response; the request
 * still succeeds.
 *
 * `POST /api/precache` — rebuild all resource metadata in a single pass
 * per resource, then generate every cover, avatar, and fullbody thumbnail
 * server-side. Returns an SSE stream with progress events and the final
 * result.
 *
 * `GET /api/precache/stream` — reconnect to an already-running precache
 * or fetch its last result. Used by the client when the precache page is
 * reopened mid-run.
 */
/**
 * Drain {@link PrecacheBus} events as an async sequence: yields every
 * emitted event, then parks until the next one or the run's terminal
 * event (`done` / `error` / `aborted`). Unsubscribes when the consumer
 * stops pulling. An optional `replay` snapshot — captured by the caller
 * before subscribing — is yielded first, so a reconnecting client sees
 * the current state without racing the live stream.
 */
async function* subscribeToBus(
	bus: PrecacheBus,
	replay?: PrecacheBusEvent,
): AsyncGenerator<PrecacheBusEvent> {
	const queue: PrecacheBusEvent[] = []
	let wake: (() => void) | null = null
	let done = false

	const unsub = bus.subscribe((evt) => {
		queue.push(evt)
		if (
			evt.event === "done" ||
			evt.event === "error" ||
			evt.event === "aborted"
		)
			done = true
		wake?.()
	})

	try {
		if (replay !== undefined) {
			yield replay
		}
		while (!done || queue.length > 0) {
			while (queue.length > 0) {
				yield queue.shift()!
			}
			if (done) break
			await new Promise<void>((resolve) => {
				wake = resolve
			})
			wake = null
		}
	} finally {
		unsub()
	}
}

async function cacheAdminPluginImpl(app: FastifyInstance): Promise<void> {
	const res = app.resService
	const trashDir = app.paths.local.trash()

	app.delete("/api/cache", async (_req, reply) => {
		if (precacheBus.isRunning()) {
			return sendJson(reply, 409, {
				message: "Cannot clear cache while precache is in progress",
			} as unknown as Record<string, unknown>)
		}
		const cacheDir = app.paths.local.cache()
		const entries = await readdir(cacheDir).catch((): string[] => [])
		const failed: string[] = []
		await Promise.all(
			entries.map(async (entry) => {
				await rm(join(cacheDir, entry), {
					recursive: true,
					force: true,
					maxRetries: 3,
					retryDelay: 200,
				}).catch(() => {
					failed.push(entry)
				})
			}),
		)
		res.clearAllMeta()
		app.charService.clearAllImageMeta()
		return sendJson(reply, 200, { cleared: true, failed })
	})

	/**
	 * `GET /api/cache/trash` — list non-empty resource entries under
	 * `local/trash/`.
	 *
	 * Only resource folders moved here by hard-delete are listed (character
	 * and db folders are skipped). Each item carries a `coverUrl` when a
	 * `.cover.*` file is found inside the folder so the client can render
	 * a thumbnail without probing further.
	 */
	app.get(
		"/api/cache/trash",
		{ config: { readOnlySafe: true } },
		async (_req, reply) => {
			const entries = await readdir(trashDir, { withFileTypes: true }).catch(
				() => [] as never[],
			)
			const items: TrashItem[] = []
			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				const parsed = parseTrashEntryName(entry.name)
				if (parsed === undefined) continue
				if (parsed.kind !== "resource") continue
				const entryPath = join(trashDir, entry.name)
				let coverUrl: string | undefined
				try {
					const files = await readdir(entryPath)
					const coverFile = files.find((f) => /^\.cover\./i.test(f))
					if (coverFile !== undefined) {
						coverUrl = `/api/cache/trash/${encodeURIComponent(entry.name)}/files/${coverFile}`
					}
				} catch {
					// ignore unreadable folders
				}
				let contentPluginId: string | undefined
				let fileStats: FileStats | undefined
				let filesList: readonly unknown[] | undefined
				if (parsed.kind === "resource" && parsed.originalId !== undefined) {
					const id = parsed.originalId
					// Lean access (no shared probe/cd caches): the same
					// wiring every live resource uses, cache misses only.
					const deps = {
						paths: app.paths,
						pluginHooks: app.pluginHooks,
						access: buildResourceAccess({
							paths: app.paths,
							pluginHooks: app.pluginHooks,
						}),
					}
					;[contentPluginId, fileStats, filesList] = await Promise.all([
						detectPluginForTrash(deps, id).catch(() => undefined),
						computeTrashedFileStats(deps, id).catch(() => undefined),
						buildTrashedFileList(deps, id).catch(() => undefined),
					])
				}
				items.push({
					...parsed,
					coverUrl,
					contentPluginId,
					fileStats,
					files: filesList,
				})
			}
			return sendJson(reply, 200, { items })
		},
	)

	/**
	 * `GET /api/cache/trash/:name/files/*` — serve a raw file from a
	 * trash entry. Used by the trash preview to display cover images.
	 */
	app.get<{ Params: { name: string; "*": string } }>(
		"/api/cache/trash/:name/files/*",
		{ config: { readOnlySafe: true } },
		async (req, reply) => {
			let name: string
			try {
				name = assertSafeSegment(req.params.name)
			} catch (err) {
				return sendError(
					reply,
					400,
					err instanceof Error ? err.message : "invalid name",
				)
			}
			const tail = req.params["*"] ?? ""
			const segments = tail.split("/").filter(Boolean)
			for (const seg of segments) {
				try {
					assertSafeSegment(seg)
				} catch (err) {
					return sendError(
						reply,
						400,
						err instanceof Error ? err.message : "invalid path segment",
					)
				}
			}
			const filePath = join(trashDir, name, ...segments)
			const trashRoot = join(trashDir, "")
			if (!filePath.startsWith(trashRoot)) {
				return sendError(reply, 400, "path escapes trash directory")
			}
			try {
				const info = await stat(filePath)
				if (!info.isFile()) {
					return sendError(reply, 404, "not found")
				}
			} catch {
				return sendError(reply, 404, "not found")
			}
			const ext = extname(filePath).toLowerCase()
			const contentType = extToContentType(ext)
			return sendFile(reply, filePath, {
				contentType,
				cacheControl: "no-store",
			})
		},
	)

	/**
	 * `GET /api/cache/trash/:name/download` — stream a trashed resource
	 * folder as a zip archive for download. The content lives under the
	 * entry's `data/` root, so it is packed through the same artifact
	 * view every live resource download uses: relative entry names,
	 * dotfiles (`.order`, `.cover.*`) excluded, upload order preserved.
	 */
	app.get<{ Params: { name: string } }>(
		"/api/cache/trash/:name/download",
		{ config: { readOnlySafe: true } },
		async (req, reply) => {
			let name: string
			try {
				name = assertSafeSegment(req.params.name)
			} catch (err) {
				return sendError(
					reply,
					400,
					err instanceof Error ? err.message : "invalid name",
				)
			}
			const entryPath = join(trashDir, name)
			const trashRoot = join(trashDir, "")
			if (!entryPath.startsWith(trashRoot)) {
				return sendError(reply, 400, "path escapes trash directory")
			}
			const parsed = parseTrashEntryName(name)
			if (parsed === undefined || parsed.kind !== "resource") {
				return sendError(reply, 404, "not found")
			}
			const view = await buildTrashedArtifactView(
				app.paths,
				parsed.originalId ?? "",
			)
			if (view === undefined) {
				return sendError(reply, 404, "not found")
			}
			const entries = await view.listEntries()
			if (entries.length === 0) {
				return sendError(reply, 404, "not found")
			}
			const packEntries = await packViewEntries(view, entries)
			if (packEntries.length === 0) {
				return sendError(reply, 404, "not found")
			}
			reply.header("content-type", "application/zip")
			reply.header(
				"content-disposition",
				`attachment; filename="${encodeURIComponent(name)}.zip"`,
			)
			reply.header("cache-control", "no-store")
			return reply.send(streamStoredZip(packEntries))
		},
	)

	app.post("/api/precache", { sse: true }, async (_req, reply) => {
		if (precacheBus.isRunning()) {
			return sendJson(reply, 409, {
				message: "Precache already in progress",
			} as unknown as Record<string, unknown>)
		}

		precacheBus.start()

		// Fire-and-forget the actual work. The work emits progress
		// events through the bus which the async generator drains below.
		const workDone = doWork(app).catch(
			(err: unknown) =>
				void precacheBus.fail(err instanceof Error ? err.message : String(err)),
		)

		await reply.sse.send(subscribeToBus(precacheBus))
		await workDone
	})

	app.post("/api/precache/abort", async (_req, reply) => {
		if (!precacheBus.isRunning()) {
			return sendJson(reply, 400, {
				message: "No precache in progress",
			} as unknown as Record<string, unknown>)
		}
		precacheBus.abort()
		return sendJson(reply, 200, { aborted: true })
	})

	app.get("/api/precache/stream", { sse: true }, async (_req, reply) => {
		// Fast path: terminal states already reached.
		if (precacheBus.getResult() !== null) {
			await reply.sse.send({ event: "done", data: precacheBus.getResult() })
			return
		}
		if (precacheBus.getError() !== null) {
			await reply.sse.send({
				event: "error",
				data: { message: precacheBus.getError() },
			})
			return
		}
		if (!precacheBus.isRunning()) {
			await reply.sse.send({ event: "idle", data: {} })
			return
		}

		// Precache is running: subscribe first (avoids race with finish),
		// then replay the most recent snapshot so the reconnecting client
		// sees the current state immediately.
		reply.sse.keepAlive()

		let aborted = false
		reply.sse.onClose(() => {
			aborted = true
		})

		const replay = precacheBus.getLastProgress()
		for await (const item of subscribeToBus(precacheBus, replay ?? undefined)) {
			if (aborted) return
			try {
				await reply.sse.send({ event: item.event, data: item.data })
			} catch {
				return
			}
		}
	})
}

async function doWork(app: FastifyInstance): Promise<void> {
	const emittedPhases = new Set<string>()
	const result = await runPrecache(
		{
			res: app.resService,
			chars: app.charService,
			thumbs: app.thumbService,
			createConcurrency: () =>
				createAdaptiveConcurrency({
					max: os.cpus().length,
					initial: Math.max(1, os.cpus().length - 1),
				}),
		},
		{
			onProgress: (phase, current, total) => {
				if (!emittedPhases.has(phase)) {
					emittedPhases.add(phase)
					precacheBus.emit("phase", { phase, total })
				}
				precacheBus.emit("progress", { phase, current, total })
			},
			isAborted: () => precacheBus.isAborted(),
		},
	)

	if (result === undefined) {
		precacheBus.emit("aborted", {})
		return
	}

	precacheBus.finish({
		resources: result.resources,
		characters: result.characters,
	})
}

export const cacheAdminPlugin =
	cacheAdminPluginImpl satisfies FastifyPluginAsync
