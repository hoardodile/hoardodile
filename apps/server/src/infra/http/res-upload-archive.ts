import { invalid } from "@hoardodile/shared"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { domainErrorToHttp, sendJson } from "./utils.ts"

/**
 * Archive staging endpoint.
 *
 * POST /api/uploads/archive
 *
 * Accepts a single multipart `archive` part containing a zip file. The
 * bytes are streamed into the global staging pool as `<fileId>.zip`
 * (the server mints the `fileId`). The caller receives `{ fileId }` and
 * later passes it to `resource.create({ archiveFileId })`. The staged
 * archive can also be deleted via `DELETE /api/uploads/ordered/:fileId`
 * (the same per-file delete endpoint used for ordered uploads).
 */
async function resUploadArchivePluginImpl(app: FastifyInstance): Promise<void> {
	const uploads = app.resUploads

	app.post("/api/uploads/archive", async (req, reply) => {
		if (!req.isMultipart()) {
			return sendJson(reply, 415, {
				error: "expected multipart/form-data",
				kind: "resource.upload_not_multipart",
			})
		}

		try {
			// Stream the first `archive` part straight to the staging pool
			// *inside* the parts loop. @fastify/multipart (busboy) will not
			// advance to the next part until the current file stream is
			// consumed, so a "collect-then-consume" pattern deadlocks — the
			// loop waits for the next part while the stored stream waits for
			// a reader. Consuming inline avoids that.
			let staged: { readonly fileId: string } | undefined
			for await (const partRaw of req.parts()) {
				const part = partRaw as MultipartPart
				if (part.type !== "file") continue
				if (part.fieldname !== "archive") {
					// Unknown file field - drain so the parser can advance.
					for await (const _ of part.file) {
						// discard
					}
					continue
				}
				if (staged !== undefined) {
					throw invalid(
						"resource.upload_too_many_archives",
						"archive upload accepts exactly one archive part",
					)
				}
				const { fileId } = await uploads.stageArchive(part.file)
				staged = { fileId }
			}
			if (staged === undefined) {
				return sendJson(reply, 400, {
					error: "archive upload requires exactly one archive file part",
					kind: "resource.upload_no_archive",
				})
			}
			return reply.send({ fileId: staged.fileId })
		} catch (err) {
			// On a parse/validation failure the client may still have a large
			// upload body in flight. Destroy `req.raw` to release the socket
			// promptly instead of pinning it until `keepAliveTimeout`.
			const response = domainErrorToHttp(reply, err)
			req.raw.destroy()
			return response
		}
	})
}

export const resUploadArchivePlugin =
	resUploadArchivePluginImpl satisfies FastifyPluginAsync

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
