import { createReadStream, createWriteStream, existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
	assertSafeSegment,
	extractArchiveInto,
	writeVersioned,
} from "@hoardodile/host/hoard"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { buildPluginUploads, moveDir } from "src/domain/plugin/upload.ts"
import { domainErrorToHttp, sendError } from "./utils.ts"

async function pluginUploadPluginImpl(app: FastifyInstance): Promise<void> {
	const uploads = buildPluginUploads({
		stagingRoot: app.paths.local.uploadStagingRoot(),
		commit: async (stagingDir, id) => {
			await writeVersioned(app.paths, app.readOnly, async (latest) => {
				const destDir = join(latest.plugins(), assertSafeSegment(id))
				await mkdir(latest.plugins(), { recursive: true })
				if (existsSync(destDir)) {
					await rm(destDir, { recursive: true, force: true })
				}
				await moveDir(stagingDir, destDir)
			})
		},
		extractArchive: extractArchiveInto,
		maxExtractedBytes: app.env.PLUGIN_UPLOAD_MAX_BYTES,
	})

	app.post("/api/plugin-upload", async (req, reply) => {
		if (!req.isMultipart()) {
			return sendError(
				reply,
				415,
				"expected multipart/form-data",
				"plugin.upload_not_multipart",
			)
		}

		const declaredLen = Number(req.headers["content-length"])
		if (
			Number.isFinite(declaredLen) &&
			declaredLen > app.env.PLUGIN_UPLOAD_MAX_BYTES
		) {
			return sendError(
				reply,
				413,
				"plugin upload exceeds maximum size",
				"plugin.upload_too_large",
			)
		}

		let archivePath: string | undefined

		try {
			// local/cache/tmp is cleaned (not created) at boot and only mkdir'd
			// lazily by other flows; ensure it exists before writing.
			await mkdir(app.paths.local.tmp(), { recursive: true })
			await mkdir(app.paths.local.uploadStagingRoot(), { recursive: true })
			for await (const partRaw of req.parts()) {
				const part = partRaw as MultipartPart
				if (part.type === "field") continue
				if (part.fieldname === "archive") {
					archivePath = `${app.paths.local.tmp()}/plugin-upload-${Date.now()}.zip`
					await pipeline(
						part.file,
						makeByteLimiter(app.env.PLUGIN_UPLOAD_MAX_BYTES),
						createWriteStream(archivePath),
					)
				} else {
					for await (const _ of part.file) {
						// drain unknown fields
					}
				}
			}

			if (archivePath === undefined) {
				return sendError(
					reply,
					400,
					"plugin upload requires an archive file part",
					"plugin.upload_no_archive",
				)
			}

			const pluginId = await uploads.installFromZip(
				createReadStream(archivePath),
			)

			await app.pluginService.rescan()

			return reply.send({ pluginId })
		} catch (err) {
			if (err instanceof UploadTooLargeError) {
				return sendError(
					reply,
					413,
					"plugin upload exceeds maximum size",
					"plugin.upload_too_large",
				)
			}
			return domainErrorToHttp(reply, err, { notFoundKind: "plugin.not_found" })
		} finally {
			if (archivePath !== undefined) {
				await rm(archivePath, { force: true }).catch(() => {})
			}
		}
	})
}

export const pluginUploadPlugin =
	pluginUploadPluginImpl satisfies FastifyPluginAsync

type MultipartPart =
	| {
			readonly type: "field"
			readonly fieldname: string
			readonly value: unknown
	  }
	| {
			readonly type: "file"
			readonly fieldname: string
			readonly filename: string
			readonly file: NodeJS.ReadableStream
	  }

class UploadTooLargeError extends Error {
	constructor() {
		super("plugin upload exceeds maximum size")
		this.name = "UploadTooLargeError"
	}
}

/**
 * Fail the pipeline once more than `maxBytes` flow through. Same pattern
 * as the character-image upload limiter: multipart's own limits only
 * truncate silently, so we enforce the cap ourselves and map it to 413.
 */
function makeByteLimiter(maxBytes: number): Transform {
	let seen = 0
	return new Transform({
		transform(chunk: Buffer, _enc, cb) {
			seen += chunk.length
			if (seen > maxBytes) {
				cb(new UploadTooLargeError())
				return
			}
			cb(null, chunk)
		},
	})
}
