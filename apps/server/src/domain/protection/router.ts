import {
	BackupError,
	recoveryMetadata,
	retentionPolicy,
} from "@hoardodile/backup"
import { TRPCError } from "@trpc/server"
import { authedProcedure, router } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { ProtectionService } from "./service.ts"

const id = z.union([z.literal("local"), z.uuid()])
const pointInput = z.object({ repositoryId: id, pointId: z.uuid() })
const procedure = authedProcedure.use(async ({ next }) => {
	try {
		return await next()
	} catch (error) {
		if (error instanceof BackupError)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: error.message,
				cause: error,
			})
		throw error
	}
})

export function buildProtectionRouter(service?: ProtectionService) {
	const get = () => {
		if (!service)
			throw new TRPCError({
				code: "SERVICE_UNAVAILABLE",
				message: "Backup services are unavailable",
			})
		return service
	}
	return router({
		status: procedure.query(({ ctx }) => ({
			...get().getStatus(),
			maintenanceActive: ctx.req.server.libraryMaintenance,
			nativeProcessesBusy: ctx.req.server.nativeProcessesBusy,
		})),
		initialize: procedure
			.input(z.object({ recoveryKey: z.string().min(1).max(4096).optional() }))
			.mutation(({ input }) => get().initialize(input.recoveryKey)),
		points: procedure
			.input(z.object({ repositoryId: id }))
			.query(({ input }) => get().listRecoveryPoints(input.repositoryId)),
		backup: procedure
			.input(recoveryMetadata)
			.mutation(({ input }) => get().createBackup(input)),
		archive: procedure
			.input(
				z.object({
					name: z.string().max(200).optional(),
					note: z.string().max(2000).optional(),
				}),
			)
			.mutation(({ input }) => get().jobs.start("archive", input)),
		check: procedure
			.input(z.object({ repositoryId: id, readData: z.boolean() }))
			.mutation(({ input }) => get().check(input.repositoryId, input.readData)),
		compare: procedure
			.input(pointInput)
			.mutation(({ input }) =>
				get().compare(input.repositoryId, input.pointId),
			),
		drill: procedure
			.input(
				pointInput.extend({
					full: z.boolean(),
					targetId: z.enum(["local", "external"]).default("local"),
				}),
			)
			.mutation(({ input }) =>
				get().drill(
					input.repositoryId,
					input.pointId,
					input.full,
					input.targetId,
				),
			),
		deletePoint: procedure
			.input(pointInput)
			.mutation(({ input }) =>
				get().deletePoint(input.repositoryId, input.pointId),
			),
		prepareRepair: procedure
			.input(
				pointInput.extend({
					paths: z.array(z.string().min(1)).min(1).max(1000),
				}),
			)
			.mutation(({ input }) =>
				get().prepareRepair(input.repositoryId, input.pointId, input.paths),
			),
		repair: procedure
			.input(z.object({ repositoryId: id, planId: z.uuid() }))
			.mutation(({ input }) => get().repair(input.repositoryId, input.planId)),
		prepareRestore: procedure
			.input(pointInput)
			.mutation(({ input }) =>
				get().prepareRestore(input.repositoryId, input.pointId),
			),
		restore: procedure
			.input(z.object({ planId: z.uuid(), confirmation: z.literal("RESTORE") }))
			.mutation(({ input }) => get().restore(input.planId, input.confirmation)),
		metadata: procedure
			.input(pointInput.extend({ metadata: recoveryMetadata }))
			.mutation(({ input }) =>
				get().updateMetadata(input.repositoryId, input.pointId, input.metadata),
			),
		recoveryKey: procedure
			.input(z.object({ repositoryId: id }))
			.mutation(({ input }) => get().exportRecoveryKey(input.repositoryId)),
		policy: procedure
			.input(retentionPolicy)
			.mutation(({ input }) => get().updatePolicy(input)),
		previewRetention: procedure
			.input(z.object({ repositoryId: id }))
			.query(({ input }) => get().previewRetention(input.repositoryId)),
		retention: procedure
			.input(z.object({ repositoryId: id, prune: z.boolean() }))
			.mutation(({ input }) =>
				get().applyRetention(input.repositoryId, input.prune),
			),
		enabled: procedure
			.input(z.object({ enabled: z.boolean() }))
			.mutation(({ input }) => get().setEnabled(input.enabled)),
		jobs: procedure.query(() => get().jobs.list()),
		job: procedure
			.input(z.object({ id: z.uuid() }))
			.query(({ input }) => get().jobs.get(input.id)),
		cancel: procedure
			.input(z.object({ id: z.uuid() }))
			.mutation(async ({ input }) => {
				await get().jobs.cancel(input.id)
				return { ok: true }
			}),
		retry: procedure
			.input(z.object({ id: z.uuid() }))
			.mutation(({ input, ctx }) => {
				const service = get()
				if (service.jobs.get(input.id)?.kind === "file-write")
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Submit the original file operation again",
					})
				const status = service.getStatus()
				if (
					service.jobs.get(input.id)?.kind === "restore" &&
					ctx.req.server.nativeProcessesBusy
				)
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "The previous native operation is still stopping",
					})
				if (
					service.jobs.get(input.id)?.kind === "restore" &&
					!status.maintenance &&
					!status.maintenanceError
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"Prepare and confirm a new restore before replacing this library again",
					})
				}
				return service.jobs.retry(input.id)
			}),
	})
}
