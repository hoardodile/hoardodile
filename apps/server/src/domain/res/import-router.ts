import type { PluginHooks, PluginLoader } from "@hoardodile/host"
import type { SessionStore } from "src/domain/auth/session.ts"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import {
	assertInsideGuard,
	browseDirectory,
	extractUploadedArchive,
	resolveBrowseGuard,
} from "./folder-import.ts"
import { importLocal, scanImportDirectory } from "./import.ts"
import type { ResService } from "./service.ts"
import type { ResUploads } from "./upload.ts"

export type ImportRouterDeps = {
	readonly resService: ResService
	readonly resUploads: ResUploads
	readonly pluginLoader: PluginLoader
	readonly pluginHooks: PluginHooks
	readonly sessions: SessionStore
	/**
	 * Absolute path to the local temp directory
	 * (`<storageRoot>/local/cache/tmp`). Extraction directories for
	 * uploaded zip archives are created under here.
	 */
	readonly tmpBase: string
}

/**
 * tRPC sub-router for the folder-import flow: browsing the shared folder
 * or a staged archive, scanning/importing a directory, and cleaning up
 * the extraction after a zip import. Lives beside the res domain so the
 * router composition file stays a pure wiring table.
 */
export function buildImportRouter(deps: ImportRouterDeps) {
	return router({
		importConfig: authedProcedure.query(async ({ ctx }) => {
			return { sharedFolderRoot: ctx.env.SHARED_FOLDER_ROOT }
		}),
		browseDirectory: authedProcedure
			.input(
				z.object({
					root: z.string().min(1),
					subPath: z.string().optional(),
				}),
			)
			.query(async ({ input, ctx }) => {
				const guardRoot = resolveBrowseGuard(
					input.root,
					ctx.env.SHARED_FOLDER_ROOT,
					deps.tmpBase,
				)
				const entries = await browseDirectory(
					input.root,
					input.subPath,
					guardRoot,
				)
				return { entries }
			}),
		extractArchive: writeProcedure
			.input(
				z.object({
					archiveFileId: z.string().uuid(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				const extractDir = await extractUploadedArchive(
					deps.resUploads,
					deps.tmpBase,
					input.archiveFileId,
					ctx.env.MAX_ARCHIVE_EXTRACTED_BYTES,
				)
				return { extractDir }
			}),
		folderScan: authedProcedure
			.input(
				z.object({
					root: z.string().min(1),
					subPath: z.string().optional(),
					contentPluginId: z.string().optional(),
				}),
			)
			.query(async ({ input, ctx }) => {
				const guardRoot = resolveBrowseGuard(
					input.root,
					ctx.env.SHARED_FOLDER_ROOT,
					deps.tmpBase,
				)
				const sourceDir = assertInsideGuard(
					input.root,
					input.subPath,
					guardRoot,
				)
				const registry = deps.pluginLoader.getRegistry()
				const entries = await scanImportDirectory(
					sourceDir,
					input.contentPluginId,
					deps.pluginHooks,
				)
				return entries.map((e) => {
					const entry = registry.getById(e.contentPluginId)
					return {
						name: e.item.name,
						path: e.item.absPath,
						kind: e.item.kind,
						contentPluginId: e.contentPluginId,
						pluginName: entry?.manifest.name ?? e.contentPluginId,
					}
				})
			}),
		folderImport: writeProcedure
			.input(
				z.object({
					root: z.string().min(1),
					subPath: z.string().optional(),
					contentPluginId: z.string().optional(),
					cleanupExtract: z.boolean().optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				const guardRoot = resolveBrowseGuard(
					input.root,
					ctx.env.SHARED_FOLDER_ROOT,
					deps.tmpBase,
				)
				const sourceDir = assertInsideGuard(
					input.root,
					input.subPath,
					guardRoot,
				)
				const report = await importLocal(
					{
						service: deps.resService,
						uploads: deps.resUploads,
						pluginHooks: deps.pluginHooks,
					},
					{
						sourceDir,
						contentPluginId: input.contentPluginId,
					},
				)
				if (input.cleanupExtract === true) {
					const { rm } = await import("node:fs/promises")
					await rm(guardRoot, {
						recursive: true,
						force: true,
					}).catch(() => {})
				}
				return report
			}),
	})
}

export type ImportRouter = ReturnType<typeof buildImportRouter>
