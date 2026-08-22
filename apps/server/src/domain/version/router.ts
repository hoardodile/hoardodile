import {
	MAX_HISTORY_NOTE_LENGTH,
	MAX_VERSION_NAME_LENGTH,
} from "@hoardodile/schemas"

import type { SignalEmitter } from "src/infra/signals.ts"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { VersionService } from "./service.ts"

const versionInput = z.object({
	version: z.number().int().positive(),
})

const createInput = z.object({
	confirmArchive: z.literal(true),
	name: z.string().max(MAX_VERSION_NAME_LENGTH).optional(),
	note: z.string().max(MAX_HISTORY_NOTE_LENGTH).optional(),
})

const updateMetaInput = z.object({
	version: z.number().int().positive(),
	name: z.string().max(MAX_VERSION_NAME_LENGTH).optional(),
	note: z.string().max(MAX_HISTORY_NOTE_LENGTH).optional(),
})

export type BuildVersionRouterDeps = {
	readonly service: VersionService
	/**
	 * Used to signal `version.changed` after a successful create or
	 * switch. The server's top-level subscriber hot-reloads the storage
	 * context in-process.
	 */
	readonly signals: SignalEmitter
}

/**
 * tRPC sub-router for the version & archive flow. Every procedure is
 * auth-guarded. The whole `version.*` namespace is exempt from the
 * read-only mutation block (see `infra/trpc/core.ts`) so the user can
 * always switch back to the current version from a past-version view.
 */
export function buildVersionRouter(deps: BuildVersionRouterDeps) {
	const { service, signals } = deps
	return router({
		list: authedProcedure.query(() => service.list()),
		current: authedProcedure.query(() => service.current()),
		active: authedProcedure.query(() => service.active()),
		create: writeProcedure.input(createInput).mutation(({ input }) => {
			const result = service.create({
				name: input.name,
				note: input.note,
			})
			signals.emit("version.changed", undefined)
			return { ...result, willRestart: false as const }
		}),
		switchTo: authedProcedure.input(versionInput).mutation(({ input }) => {
			service.switchTo(input.version)
			signals.emit("version.changed", undefined)
			return { version: input.version, willRestart: false as const }
		}),
		updateMeta: writeProcedure.input(updateMetaInput).mutation(({ input }) =>
			service.updateMeta(input.version, {
				name: input.name,
				note: input.note,
			}),
		),
	})
}
