import { randomUUID } from "node:crypto"
import { createReadStream, existsSync, mkdirSync, rmSync } from "node:fs"
import { isDomainError } from "@hoardodile/shared"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { buildAttachmentContentDisposition } from "./attachment-filename.ts"
import { domainErrorToHttp, sendError } from "./utils.ts"

const backupDownloadParamsSchema = {
	type: "object",
	properties: {
		fileName: { type: "string", minLength: 1, maxLength: 255 },
	},
	required: ["fileName"],
} as const

const versionDbParamsSchema = {
	type: "object",
	properties: {
		version: { type: "string", pattern: "^\\d+$" },
	},
	required: ["version"],
} as const

/**
 * Download routes for individual database files, behind the enclosing
 * `protectedHttpPlugin` auth hook. Streaming is read-only: frozen version
 * snapshots and manual backups are sent as-is, while the live (latest)
 * version is first snapshotted via `VACUUM INTO` so the download is
 * consistent despite the WAL.
 */
async function backupFilesPluginImpl(app: FastifyInstance): Promise<void> {
	app.get<{ Params: { fileName: string } }>(
		"/api/backups/:fileName/download",
		{
			schema: { params: backupDownloadParamsSchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			let filePath: string
			try {
				filePath = await app.backupService.resolveFilePath(req.params.fileName)
			} catch (err) {
				// assertSafeSegment rejects traversal with a plain Error; domain
				// errors (missing backup) are forwarded with their own status.
				if (isDomainError(err)) return domainErrorToHttp(reply, err)
				return sendError(
					reply,
					400,
					err instanceof Error ? err.message : "invalid file name",
				)
			}
			reply.header("content-type", "application/octet-stream")
			reply.header(
				"content-disposition",
				buildAttachmentContentDisposition({
					utf8Filename: req.params.fileName,
				}),
			)
			return reply.send(createReadStream(filePath))
		},
	)

	app.get<{ Params: { version: string } }>(
		"/api/versions/:version/db.sqlite",
		{
			schema: { params: versionDbParamsSchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const version = Number(req.params.version)
			if (!Number.isSafeInteger(version) || version < 1) {
				return sendError(reply, 400, `invalid version ${req.params.version}`)
			}
			const latest = app.paths.latestVersion
			if (version > latest) {
				return sendError(reply, 404, `version ${version} does not exist`)
			}

			reply.header("content-type", "application/octet-stream")
			reply.header(
				"content-disposition",
				buildAttachmentContentDisposition({
					utf8Filename: `app-v${version}.sqlite`,
				}),
			)

			if (version < latest) {
				// Archived versions hold a frozen snapshot written at archive time.
				const filePath = app.paths.atVersion(version).versionSnapshotDb()
				if (!existsSync(filePath)) {
					return sendError(
						reply,
						404,
						`version ${version} snapshot does not exist`,
					)
				}
				return reply.send(createReadStream(filePath))
			}

			// The latest version has no frozen snapshot; its data lives only in
			// the live runtime DB. Snapshot it into a temp file first so the
			// download is consistent, then remove the temp file once streamed.
			const tmpDir = app.paths.local.tmp()
			mkdirSync(tmpDir, { recursive: true })
			const tmpPath = app.paths.local.tmpFile(
				`db-download-${randomUUID()}.sqlite`,
			)
			try {
				await app.backupService.snapshotRuntimeDb(tmpPath)
			} catch (err) {
				rmSync(tmpPath, { force: true })
				return domainErrorToHttp(reply, err)
			}
			const stream = createReadStream(tmpPath)
			const cleanup = () => {
				rmSync(tmpPath, { force: true })
			}
			stream.on("close", cleanup)
			stream.on("error", cleanup)
			return reply.send(stream)
		},
	)
}

export const backupFilesPlugin =
	backupFilesPluginImpl satisfies FastifyPluginAsync
