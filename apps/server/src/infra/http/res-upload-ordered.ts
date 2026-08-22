import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { domainErrorToHttp, sendJson } from "./utils.ts"

/**
 * Per-file ordered upload endpoints.
 *
 * POST /api/uploads/ordered
 *   Accepts multipart/form-data with a single `file` part. The server mints
 *   a fresh `fileId` (UUID), streams the file into the global staging pool,
 *   and returns `{ fileId }`. The client references this `fileId` later in
 *   an ordered list at resource creation; it may also delete the staged
 *   file via DELETE. There is no `uploadId` grouping — each file is
 *   independent, so adding / removing / reordering files never requires
 *   re-uploading bytes that have already been staged.
 *
 * DELETE /api/uploads/ordered/:fileId
 *   Removes a single staged file from the global pool. Returns 404 when
 *   `fileId` is not present.
 */
async function resUploadOrderedPluginImpl(app: FastifyInstance): Promise<void> {
	const uploads = app.resUploads

	app.post("/api/uploads/ordered", async (req, reply) => {
		if (!req.isMultipart()) {
			return sendJson(reply, 415, {
				error: "expected multipart/form-data",
				kind: "resource.upload_not_multipart",
			})
		}

		try {
			// Stream the first `file` part straight to the staging pool
			// *inside* the parts loop. @fastify/multipart (busboy) will not
			// advance to the next part until the current file stream is
			// consumed, so a "collect-then-consume" pattern deadlocks — the
			// loop waits for the next part while the stored stream waits for
			// a reader. Consuming inline avoids that.
			let staged: { readonly fileId: string } | undefined
			for await (const partRaw of req.parts()) {
				const part = partRaw as MultipartPart
				if (part.type !== "file") continue
				if (part.fieldname !== "file") {
					// Unknown file field - drain so the parser can advance.
					for await (const _ of part.file) {
						// discard
					}
					continue
				}
				if (staged !== undefined) {
					// Extra `file` parts beyond the first: drain.
					for await (const _ of part.file) {
						// discard
					}
					continue
				}
				const { fileId } = await uploads.stageSingleFile(
					part.filename,
					part.file,
				)
				staged = { fileId }
			}
			if (staged === undefined) {
				return sendJson(reply, 400, {
					error: "ordered upload requires exactly one file part",
					kind: "resource.upload_no_files",
				})
			}
			return reply.send({ fileId: staged.fileId })
		} catch (err) {
			// On a parse/validation failure the client may still have a large
			// upload body in flight. Failing to consume or destroy `req.raw`
			// leaves the inbound stream open, which under TCP back-pressure
			// pins the connection - and every keep-alive request behind it -
			// until `keepAliveTimeout`, surfacing as a request stuck in
			// "pending". Drain isn't practical for huge bodies, so destroy
			// the stream to release the socket promptly.
			const response = domainErrorToHttp(reply, err)
			req.raw.destroy()
			return response
		}
	})

	app.delete("/api/uploads/ordered/:fileId", async (req, reply) => {
		const { fileId } = req.params as { fileId: string }
		const removed = await uploads.discardStagedFile(fileId)
		if (!removed) {
			return sendJson(reply, 404, {
				error: "staged file not found",
				kind: "resource.upload_staging_not_found",
			})
		}
		return reply.send({ ok: true })
	})
}

export const resUploadOrderedPlugin =
	resUploadOrderedPluginImpl satisfies FastifyPluginAsync

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
