import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname } from "node:path"
import type { Readable } from "node:stream"
import type { ResourceContainer } from "@hoardodile/host"
import { streamStoredZip, type ZipStreamEntry } from "@hoardodile/host/hoard"
import { err, isErr, ok, type Result } from "@hoardodile/sdk-types"
import {
	IMAGE_VARIANT_FITS,
	IMAGE_VARIANT_FORMATS,
	IMAGE_VARIANT_MAX_AREA,
	IMAGE_VARIANT_MAX_QUALITY,
	IMAGE_VARIANT_MIN_QUALITY,
	parseImageVariantQuery,
} from "@hoardodile/sdk-types/image-variant"
import { DOWNLOAD_CONTENT_TYPES } from "@hoardodile/shared"

import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify"
import { buildTrashedArtifactView } from "src/domain/res/trash-fallback.ts"
import { assertInside, assertSafeSegment } from "src/infra/storage/paths.ts"
import {
	buildAttachmentContentDisposition,
	bulkPackFolderName,
	resourceDownloadDisposition,
} from "./attachment-filename.ts"
import { parseByteRange, sliceStream } from "./byte-range.ts"
import { sendFile } from "./conditional-request.ts"
import {
	domainErrorToHttp,
	imageFormatContentType,
	sendError,
} from "./utils.ts"

type Params = { id: string; "*": string }
type Querystring = {
	size?: string
	fmt?: string
	fit?: string
	area?: number
	q?: number
}

const resFileQuerySchema = {
	type: "object",
	properties: {
		// `size=preview` is the compatibility alias for the default
		// variant; the explicit variant parameters below are the generic
		// contract (see @hoardodile/sdk-types/image-variant).
		size: { type: "string", enum: ["preview"] },
		fmt: { type: "string", enum: [...IMAGE_VARIANT_FORMATS] },
		fit: { type: "string", enum: [...IMAGE_VARIANT_FITS] },
		area: {
			type: "integer",
			minimum: 1,
			maximum: IMAGE_VARIANT_MAX_AREA,
		},
		q: {
			type: "integer",
			minimum: IMAGE_VARIANT_MIN_QUALITY,
			maximum: IMAGE_VARIANT_MAX_QUALITY,
		},
	},
} as const

const resFileParamsSchema = {
	type: "object",
	properties: {
		id: { type: "string", minLength: 1, maxLength: 255 },
	},
	required: ["id"],
} as const

const MAX_BULK_PACK_IDS = 150

const bulkSourceZipBodySchema = {
	type: "object",
	properties: {
		ids: {
			type: "array",
			items: { type: "string", minLength: 1, maxLength: 255 },
			minItems: 1,
			maxItems: MAX_BULK_PACK_IDS,
		},
		sortByCreated: { type: "boolean" },
		dateStamp: {
			type: "string",
			pattern: "^\\d{4}-\\d{2}-\\d{2}$",
			description:
				"Calendar date (YYYY-MM-DD) in the user's IANA zone for the ZIP filename.",
		},
	},
	required: ["ids", "dateStamp"],
} as const

type BulkSourceZipBody = {
	readonly ids: readonly string[]
	readonly sortByCreated?: boolean
	readonly dateStamp: string
}

/**
 * Fastify plugin registering a range-capable GET route for resource
 * binaries. The route sits behind the enclosing `protectedHttpPlugin`
 * auth hook and the server-level LAN guard.
 *
 * The on-disk source is a bare-file resource folder (entries served via
 * direct file IO; `outer!inner` container addressing served via
 * decompressed streams). This layer translates HTTP `Range` headers
 * into windows over `view.resolveByteRange(filename)`.
 */
async function resFilesPluginImpl(app: FastifyInstance): Promise<void> {
	const service = app.resService

	/**
	 * Footprint the export. Exports are read-only-safe routes, so the log
	 * write is skipped while the server views a read-only archive.
	 */
	function recordExport(
		resourceId: string,
		entityName: string,
		bulk: boolean,
	): void {
		if (app.readOnly) return
		app.traceService.record({
			action: "resource.export",
			entityType: "resource",
			entityId: resourceId,
			entityName,
			detail: bulk ? { bulk: true } : undefined,
		})
	}

	app.post<{ Body: BulkSourceZipBody }>(
		"/api/resources/bulk-source.zip",
		{
			schema: { body: bulkSourceZipBodySchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const sortByCreated = req.body.sortByCreated !== false
			const rawIds = req.body.ids
			const ids = dedupePreserveOrder(rawIds)
			let safeIds: string[]
			try {
				safeIds = ids.map((id) => assertSafeSegment(id))
			} catch (err) {
				return sendError(
					reply,
					400,
					err instanceof Error ? err.message : "invalid id",
				)
			}
			type BulkPackRow = {
				readonly id: string
				readonly name: string
				readonly entries: readonly string[]
				readonly view: Awaited<ReturnType<typeof service.resolveSourceView>>
				readonly createdAt: number
				readonly folder: string
			}
			type BulkPackRowInput = Omit<BulkPackRow, "folder">
			const rows: BulkPackRowInput[] = []
			for (const id of safeIds) {
				let detail: Awaited<ReturnType<typeof service.detail>>
				try {
					detail = await service.detail(id)
				} catch (err) {
					return domainErrorToHttp(reply, err)
				}
				let view: Awaited<ReturnType<typeof service.resolveSourceView>>
				try {
					view = await service.resolveSourceView(id)
				} catch (err) {
					return domainErrorToHttp(reply, err)
				}
				const entries = await view.listEntries()
				rows.push({
					id,
					name: detail.name,
					entries,
					view,
					createdAt: detail.createdAt,
				})
			}
			const ordered = sortByCreated
				? [...rows].sort((a, b) => {
						if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
						return a.id.localeCompare(b.id)
					})
				: rows
			const resources: BulkPackRow[] = ordered.map((r, i) => ({
				...r,
				folder: bulkPackFolderName(i + 1, r.id, r.name),
			}))
			let totalFiles = 0
			for (const r of resources) totalFiles += r.entries.length
			if (totalFiles === 0) {
				return sendError(
					reply,
					400,
					"no source files in selection",
					"resource.bulk_pack_empty",
				)
			}
			for (const r of resources) {
				recordExport(r.id, r.name, true)
			}
			const dateStamp = req.body.dateStamp
			const bulkUtf8 = `hoardodile-resources-${dateStamp}.zip`
			reply.header("content-type", "application/zip")
			reply.header(
				"content-disposition",
				buildAttachmentContentDisposition({ utf8Filename: bulkUtf8 }),
			)
			reply.header("cache-control", "no-store")
			const packEntries: ZipStreamEntry[] = []
			for (const r of resources) {
				packEntries.push(
					...(await packViewEntries(r.view, r.entries, r.folder)),
				)
			}
			return reply.send(streamStoredZip(packEntries))
		},
	)

	app.get<{ Params: { id: string } }>(
		"/api/resources/:id/source.zip",
		{
			schema: {
				params: {
					type: "object",
					properties: {
						id: { type: "string", minLength: 1, maxLength: 255 },
					},
					required: ["id"],
				} as const,
			},
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			let id: string
			try {
				id = assertSafeSegment(req.params.id)
			} catch (err) {
				return sendError(
					reply,
					400,
					err instanceof Error ? err.message : "invalid id",
				)
			}
			let resName: string
			let view: Awaited<ReturnType<typeof service.resolveSourceView>>
			try {
				const resource = await service.detail(id)
				resName = resource.name
				view = await service.resolveSourceView(id)
			} catch (err) {
				const trashedView = await buildTrashedArtifactView(app.paths, id)
				if (trashedView === undefined) {
					return domainErrorToHttp(reply, err)
				}
				resName = id
				view = trashedView
			}
			reply.header("content-type", "application/zip")
			reply.header(
				"content-disposition",
				resourceDownloadDisposition(id, resName, ".zip"),
			)
			reply.header("cache-control", "private, max-age=31536000, immutable")
			const entries = await view.listEntries()
			if (entries.length === 0) {
				// No artifact committed yet — nothing to pack.
				return sendError(
					reply,
					404,
					"source not found",
					"resource.source_not_found",
				)
			}
			recordExport(id, resName, false)
			const packEntries = await packViewEntries(view, entries)
			if (packEntries.length === 0) {
				return sendError(
					reply,
					404,
					"source not found",
					"resource.source_not_found",
				)
			}
			return reply.send(streamStoredZip(packEntries))
		},
	)

	app.get<{ Params: Params; Querystring: Querystring }>(
		"/api/resources/:id/files/*",
		{
			schema: {
				params: resFileParamsSchema,
				querystring: resFileQuerySchema,
			},
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const parsed = parseParams(req.params)
			if (isErr(parsed)) return sendError(reply, parsed.code, parsed.message)
			const { id, filename, ext } = parsed
			let resName: string
			let view: Awaited<ReturnType<typeof service.resolveSourceView>>
			try {
				const resource = await service.detail(id)
				resName = resource.name
				view = await service.resolveSourceView(id)
			} catch (err) {
				const trashedView = await buildTrashedArtifactView(app.paths, id)
				if (trashedView === undefined) {
					return domainErrorToHttp(reply, err)
				}
				resName = id
				view = trashedView
			}

			const variant = parseImageVariantQuery(req.query)
			if (variant.kind === "invalid") {
				return sendError(
					reply,
					400,
					variant.reason,
					"resource.invalid_image_variant",
				)
			}
			if (variant.kind === "variant") {
				const result = await app.thumbService.getFilePreview(
					id,
					filename,
					variant.spec,
				)
				if (result.kind === "unavailable") {
					return sendError(
						reply,
						404,
						"no preview size",
						"resource.file_not_found",
					)
				}
				return sendFile(reply, result.path, {
					contentType: imageFormatContentType(result.format),
					cacheControl: "private, max-age=31536000, immutable",
				})
			}

			// Container addressing (`outer!inner`): the entry lives inside
			// a nested zip/tar, so it has no byte window in the archive —
			// serve the decompressed stream instead of a file range.
			if (filename.includes("!")) {
				try {
					return await serveVirtualEntry(
						reply,
						view,
						filename,
						ext,
						req.headers.range,
					)
				} catch {
					return sendError(
						reply,
						404,
						"file not found",
						"resource.file_not_found",
					)
				}
			}

			// A missing entry (or one the container cannot read, e.g.
			// non-STORED) surfaces as a plain 404 — the route never lets
			// an archive-level error escape to a 500.
			let entry: {
				readonly stream: Readable
				readonly size: number
				readonly mtimeMs?: number
				readonly path?: string
			}
			try {
				entry = await view.openEntryStream(filename)
			} catch {
				return sendError(
					reply,
					404,
					"file not found",
					"resource.file_not_found",
				)
			}
			const contentType =
				DOWNLOAD_CONTENT_TYPES[ext] ?? "application/octet-stream"
			reply.header("accept-ranges", "bytes")
			reply.header("content-type", contentType)
			reply.header(
				"content-disposition",
				resourceDownloadDisposition(id, resName, ext),
			)
			reply.header("cache-control", "private, max-age=31536000, immutable")
			// Resources are immutable, so size+mtime is a stable strong
			// entity tag — free revalidation for full downloads and a
			// reliable If-Range anchor for resumable video/audio.
			const etag =
				entry.mtimeMs === undefined
					? undefined
					: `"${entry.size}-${Math.floor(entry.mtimeMs)}"`
			if (etag !== undefined) reply.header("etag", etag)

			const rangeHeader = req.headers.range
			if (rangeHeader === undefined || !rangeHeader.startsWith("bytes=")) {
				if (etag !== undefined && req.headers["if-none-match"] === etag) {
					reply.code(304)
					return reply.send()
				}
				reply.header("content-length", String(entry.size))
				if (entry.size === 0) return reply.send(Buffer.alloc(0))
				return reply.send(entry.stream)
			}
			const parsedRange = parseByteRange(rangeHeader, entry.size)
			if (isErr(parsedRange)) {
				reply.header("content-range", `bytes */${entry.size}`)
				return sendError(
					reply,
					416,
					"invalid or unsatisfiable range",
					"resource.range_not_satisfiable",
				)
			}
			const { start, end } = parsedRange
			reply.code(206)
			reply.header("content-range", `bytes ${start}-${end}/${entry.size}`)
			reply.header("content-length", String(end - start + 1))
			// Literal entries stream through a kernel-seeked window — the
			// generic sliceStream would drain the whole file from position
			// 0 and discard the prefix (a 90% seek reads 90% of the file).
			// The container's full-file stream is unused here; destroy it
			// so the range request never leaks an open handle. Virtual
			// entries have no byte window and keep the decompressed-stream
			// slice.
			let stream: Readable
			if (entry.path !== undefined) {
				entry.stream.destroy()
				stream = createReadStream(entry.path, { start, end })
			} else {
				stream = sliceStream(entry.stream, start, end)
			}
			return reply.send(stream)
		},
	)

	// ── Plugin extraction cache ────────────────────────────────────────────

	app.get<{ Params: Params }>(
		"/api/resources/:id/extracted/*",
		{
			schema: { params: resFileParamsSchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const parsed = parseParams(req.params)
			if (isErr(parsed)) return sendError(reply, parsed.code, parsed.message)
			const { id, filename } = parsed
			let view: Awaited<ReturnType<typeof service.resolveSourceView>>
			try {
				view = await service.resolveSourceView(id)
			} catch (err) {
				return domainErrorToHttp(reply, err)
			}
			const extractedRoot = app.paths.local.resExtractedArchivesDir(
				view.resId,
				view.fileVersion,
			)
			const target = assertInside(
				extractedRoot,
				joinPath(extractedRoot, filename),
			)
			const info = await stat(target).catch(() => undefined)
			if (info === undefined || !info.isFile()) {
				return sendError(
					reply,
					404,
					"extracted file not found",
					"resource.file_not_found",
				)
			}
			const ext = extname(filename).toLowerCase()
			const contentType =
				DOWNLOAD_CONTENT_TYPES[ext] ?? "application/octet-stream"
			reply.header("content-type", contentType)
			reply.header("cache-control", "private, max-age=31536000, immutable")
			return reply.send(createReadStream(target))
		},
	)

	// ── In-flight extraction progress ──────────────────────────────────────
	// The `<token>/` tail is stripped by the auth preHandler (see
	// infra/http/plugin.ts); this handler only needs the resource id.

	app.get<{ Params: { id: string } }>(
		"/api/resources/:id/extract-progress/*",
		{
			schema: { params: resFileParamsSchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const { id } = req.params
			const row = service.extractProgress.read(id)
			if (row === undefined) {
				return sendJson(reply, null)
			}
			return sendJson(reply, { done: row.done, total: row.total })
		},
	)
}

export const resFilesPlugin = resFilesPluginImpl satisfies FastifyPluginAsync

/**
 * Open every entry of `view` and pack it into a logical zip entry.
 * Unreadable entries are skipped rather than aborting the whole
 * export. When `folderPrefix` is given, entry names are nested under
 * it — used by bulk exports so each resource packs into its own
 * subfolder. Shared with the trash download (cache-admin.ts), which
 * packs trashed resource content the same way.
 */
export async function packViewEntries(
	view: Pick<ResourceContainer, "openEntryStream">,
	entries: readonly string[],
	folderPrefix?: string,
): Promise<ZipStreamEntry[]> {
	const out: ZipStreamEntry[] = []
	for (const rel of entries) {
		const entry = await view.openEntryStream(rel).catch(() => undefined)
		if (entry === undefined) continue
		const name = rel.replace(/\\/g, "/")
		out.push({
			name: folderPrefix !== undefined ? `${folderPrefix}/${name}` : name,
			size: entry.size,
			openStream: () => entry.stream,
		})
	}
	return out
}

/**
 * Serve a virtual container entry (`outer!inner`) over HTTP. The entry
 * has no byte window inside the archive, so the decompressed stream is
 * served with an optional byte-range skip. A missing entry or a literal
 * path that merely contains `!` surfaces as 404.
 */
async function serveVirtualEntry(
	reply: FastifyReply,
	view: Pick<ResourceContainer, "openEntryStream">,
	filename: string,
	ext: string,
	rangeHeader: string | undefined,
): Promise<unknown> {
	const { stream, size } = await view.openEntryStream(filename)
	const contentType = DOWNLOAD_CONTENT_TYPES[ext] ?? "application/octet-stream"
	reply.header("accept-ranges", "bytes")
	reply.header("content-type", contentType)
	reply.header("cache-control", "private, max-age=31536000, immutable")

	if (rangeHeader === undefined || !rangeHeader.startsWith("bytes=")) {
		reply.header("content-length", String(size))
		if (size === 0) return reply.send(Buffer.alloc(0))
		return reply.send(stream)
	}
	const parsedRange = parseByteRange(rangeHeader, size)
	if (isErr(parsedRange)) {
		reply.header("content-range", `bytes */${size}`)
		return sendError(
			reply,
			416,
			"invalid or unsatisfiable range",
			"resource.range_not_satisfiable",
		)
	}
	const { start, end } = parsedRange
	reply.code(206)
	reply.header("content-range", `bytes ${start}-${end}/${size}`)
	reply.header("content-length", String(end - start + 1))
	return reply.send(sliceStream(stream, start, end))
}

function joinPath(...segments: readonly string[]): string {
	return segments.join("/").replace(/\\/g, "/")
}

function sendJson(reply: FastifyReply, value: unknown): FastifyReply {
	return reply
		.type("application/json")
		.header("cache-control", "no-store")
		.send(value === undefined ? null : value)
}

function dedupePreserveOrder(ids: readonly string[]): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const id of ids) {
		if (seen.has(id)) continue
		seen.add(id)
		out.push(id)
	}
	return out
}

type ParsedParams = Result<
	{
		readonly id: string
		readonly filename: string
		readonly ext: string
	},
	{ readonly code: number; readonly message: string }
>

function parseParams(raw: Params): ParsedParams {
	try {
		const id = assertSafeSegment(raw.id)
		const tail = raw["*"] ?? ""
		if (tail.length === 0) {
			return err({ code: 400, message: "filename is required" })
		}
		const segments = tail.split("/")
		for (const seg of segments) assertSafeSegment(seg)
		const filename = segments.join("/")
		const ext = extname(filename).toLowerCase()
		return ok({ id, filename, ext })
	} catch (caught) {
		return err({
			code: 400,
			message:
				caught instanceof Error ? caught.message : "invalid path segment",
		})
	}
}
