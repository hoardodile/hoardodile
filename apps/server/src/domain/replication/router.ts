import type { SyncEngine } from "@hoardodile/sync"
import { TRPCError } from "@trpc/server"
import type { ProtectionService } from "src/domain/protection/service.ts"
import { authedProcedure, router } from "src/infra/trpc/core.ts"
import { z } from "zod"

export function buildReplicationRouter(
	service?: SyncEngine,
	protection?: ProtectionService,
) {
	const get = () => {
		if (!service)
			throw new TRPCError({
				code: "SERVICE_UNAVAILABLE",
				message: "Sync is unavailable",
			})
		return service
	}
	return router({
		status: authedProcedure.query(() => get().getStatus()),
		configure: authedProcedure
			.input(
				z.object({
					role: z.enum(["unconfigured", "send", "receive"]),
					name: z.string().min(1).max(64),
					paused: z.boolean(),
				}),
			)
			.mutation(({ input }) => get().configure(input)),
		invitation: authedProcedure.mutation(() => get().createInvitation()),
		connect: authedProcedure
			.input(
				z.object({
					url: z.url(),
					code: z.string().min(32).max(256),
					fingerprint: z.string().optional(),
				}),
			)
			.mutation(({ input }) => get().connect(input)),
		disconnect: authedProcedure.mutation(() => get().disconnect()),
		revoke: authedProcedure
			.input(z.object({ id: z.uuid() }))
			.mutation(({ input }) => get().revoke(input.id)),
		linkDevice: authedProcedure
			.input(z.object({ recordId: z.uuid(), instanceId: z.uuid().nullable() }))
			.mutation(({ input }) =>
				get().linkDevice(input.recordId, input.instanceId),
			),
		receive: authedProcedure.mutation(() => {
			if (!protection) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" })
			const active = protection.jobs
				.list()
				.find(
					(job) =>
						job.kind === "receive" &&
						["queued", "running", "cancelling"].includes(job.state),
				)
			return active ?? protection.jobs.start("receive", {})
		}),
	})
}
