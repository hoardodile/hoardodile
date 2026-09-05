import { join } from "node:path"
import { Readable } from "node:stream"
import { BackupError } from "@hoardodile/backup"
import {
	createProxyResolver,
	proxyFor,
	resolveProxyConfig,
} from "@hoardodile/shared/net-proxy"
import { createSyncEngine } from "@hoardodile/sync"
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"

export async function registerReplication(app: FastifyInstance): Promise<void> {
	const protection = app.protectionService
	const resolver = createProxyResolver(() =>
		resolveProxyConfig(process.env, process.platform),
	)
	const service = await createSyncEngine({
		instanceId: protection.getStatus().instanceId,
		directory: join(app.paths.local.root, "replication"),
		engine: protection.engine,
		localRepository: () => protection.repository("local"),
		listLocalPoints: () => protection.listRecoveryPoints("local"),
		registerSource: (input) => protection.registerSource(input),
		withRepository: (id, operation) => protection.locks.run(id, operation),
		onReceived: (id) => protection.recordReceipt(id),
		sourceBusy: () => protection.locks.busy("local"),
		proxyFor: (url) => proxyFor(url, resolver())?.toString(),
		rcloneBinary: app.env.RCLONE_BIN_PATH,
		processDirectory: join(app.paths.local.root, "protection", "processes"),
	})
	app.decorate("replicationService", service)
	protection.registerJobHandler("receive", async (_input, context) => {
		const result = await service.receive(context)
		if (result.received.length) await protection.recordReceipt(result.sourceId)
		return result
	})
	let pending: string | undefined
	let due = 0
	let failures = 0
	let checking = false
	async function tick() {
		if (checking || app.libraryMaintenance) return
		checking = true
		try {
			const state = service.getStatus()
			if (state.role !== "receive" || !state.source || state.paused) return
			if (pending) {
				const job = protection.jobs.get(pending)
				if (job && ["queued", "running", "cancelling"].includes(job.state))
					return
				failures = job?.state === "succeeded" ? 0 : Math.min(failures + 1, 3)
				due = Date.now() + (failures ? [1, 2, 5][failures - 1]! : 5) * 60_000
				pending = undefined
			}
			if (Date.now() < due || state.receiving) return
			pending = (await protection.jobs.start("receive", {})).id
		} catch (error) {
			due = Date.now() + 60_000
			app.log.error({ error }, "replication.scheduler_failed")
		} finally {
			checking = false
		}
	}
	const timer = setInterval(() => {
		void tick()
	}, 5000)
	timer.unref()
	app.addHook("onReady", async () => {
		void tick()
	})
	app.addHook("preClose", async () => {
		clearInterval(timer)
		await service.close()
	})
	await app.register(async (scope) => {
		scope.addContentTypeParser(
			"application/octet-stream",
			{ parseAs: "buffer", bodyLimit: 64 * 1024 },
			(_request, body, done) => done(null, body),
		)
		const handled = async (
			reply: FastifyReply,
			operation: () => Promise<unknown>,
		) => {
			try {
				return await operation()
			} catch (error) {
				const code =
					error instanceof BackupError ? error.code : "invalid_request"
				return reply
					.code(
						code === "peer_unauthorized" || code === "invalid_invitation"
							? 401
							: 400,
					)
					.send({ code, error: "The sync request could not be completed" })
			}
		}
		scope.post(
			"/api/sync/pair",
			{
				bodyLimit: 4096,
				config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
			},
			(request, reply) =>
				handled(reply, () => service.acceptPairing(request.body)),
		)
		scope.get("/api/sync/points", (request, reply) =>
			handled(reply, () => service.catalog(request.headers.authorization)),
		)
		scope.post("/api/sync/begin", (request, reply) =>
			handled(reply, () => service.begin(request.headers.authorization)),
		)
		scope.post("/api/sync/end", (request, reply) =>
			handled(reply, async () => {
				const { sessionId } = z
					.object({ sessionId: z.uuid() })
					.parse(request.body)
				await service.end(request.headers.authorization, sessionId)
				return { ok: true }
			}),
		)
		scope.post("/api/sync/acknowledge", (request, reply) =>
			handled(reply, async () => {
				const { pointId } = z.object({ pointId: z.uuid() }).parse(request.body)
				await service.acknowledge(request.headers.authorization, pointId)
				return { ok: true }
			}),
		)
		scope.route<{ Params: { "*": string } }>({
			method: ["GET", "HEAD", "POST", "DELETE"],
			url: "/api/sync/repository/*",
			bodyLimit: 64 * 1024,
			async handler(request, reply) {
				return handled(reply, async () => {
					const body = Buffer.isBuffer(request.body)
						? Readable.from(request.body)
						: undefined
					const upstream = await service.proxyRepository({
						authorization: request.headers.authorization,
						sessionId:
							typeof request.headers["x-hoardodile-transfer"] === "string"
								? request.headers["x-hoardodile-transfer"]
								: undefined,
						path: request.params["*"],
						method: request.method,
						headers: request.headers,
						body,
					})
					for (const name of [
						"content-type",
						"content-length",
						"content-range",
						"accept-ranges",
						"etag",
					]) {
						const value = upstream.headers[name]
						if (value !== undefined) reply.header(name, value)
					}
					return reply.code(upstream.statusCode ?? 502).send(upstream)
				})
			},
		})
	})
}
