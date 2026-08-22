import {
	MAX_BACKUP_NAME_LENGTH,
	MAX_HISTORY_NOTE_LENGTH,
} from "@hoardodile/schemas"

import type { SignalEmitter } from "src/infra/signals.ts"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { BackupService } from "./service.ts"

const fileNameInput = z.object({
	fileName: z.string().min(1).max(MAX_BACKUP_NAME_LENGTH),
})

const createInput = z.object({
	name: z.string().max(MAX_BACKUP_NAME_LENGTH).optional(),
	note: z.string().max(MAX_HISTORY_NOTE_LENGTH).optional(),
})

const updateMetaInput = z.object({
	fileName: z.string().min(1).max(MAX_BACKUP_NAME_LENGTH),
	name: z.string().max(MAX_BACKUP_NAME_LENGTH).optional(),
	note: z.string().max(MAX_HISTORY_NOTE_LENGTH).optional(),
})

export type BuildBackupRouterDeps = {
	readonly service: BackupService
	/**
	 * Emitter used to signal that a restore has been staged on disk. The
	 * server listens for the `backup.restoreRequested` signal at build time
	 * and hot-reloads its storage context in-process. Passing the emitter --
	 * rather than a raw callback -- keeps configuration out of the router layer.
	 */
	readonly signals: SignalEmitter
}

/**
 * tRPC sub-router for the backup / restore flow. Every procedure is
 * auth-guarded. `restore` stages the swap on disk and emits a
 * `backup.restoreRequested` signal; the server's top-level subscriber
 * performs an in-process reload so the HTTP response still flushes.
 */
export function buildBackupRouter(deps: BuildBackupRouterDeps) {
	const { service, signals } = deps
	return router({
		list: authedProcedure.query(() => service.list()),
		autoStatus: authedProcedure.query(() => service.getAutoStatus()),
		create: writeProcedure
			.input(createInput)
			.mutation(({ input }) => service.create(input)),
		delete: writeProcedure.input(fileNameInput).mutation(({ input }) => {
			service.delete(input.fileName)
		}),
		restore: writeProcedure.input(fileNameInput).mutation(({ input }) => {
			service.prepareRestore(input.fileName)
			signals.emit("backup.restoreRequested", undefined)
			return { fileName: input.fileName, willRestart: false }
		}),
		updateMeta: writeProcedure.input(updateMetaInput).mutation(({ input }) =>
			service.updateMeta(input.fileName, {
				name: input.name,
				note: input.note,
			}),
		),
	})
}
