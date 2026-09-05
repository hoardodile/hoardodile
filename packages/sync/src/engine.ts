import {
	createHash,
	randomBytes,
	randomUUID,
	timingSafeEqual,
} from "node:crypto"
import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
} from "node:http"
import { join } from "node:path"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { setTimeout as delay } from "node:timers/promises"
import {
	atomicWrite,
	type BackupEngine,
	BackupError,
	type JobContext,
	type RecoveryPoint,
	type Repository,
	readJsonState,
	recoveryHeader,
	recoveryMetadata,
} from "@hoardodile/backup"
import { z } from "zod"
import {
	createPeerClient,
	loopbackRequest,
	type PeerAddress,
	validatePeerAddress,
} from "./network.ts"
import { serveRestic } from "./rclone.ts"

const peer = z.object({
	id: z.uuid(),
	name: z.string().min(1).max(64),
	tokenHash: z.string(),
	lastSeenAt: z.number(),
	receivedPointId: z.uuid().nullable(),
	receivedAt: z.number().nullable(),
	receivedDataAt: z.number().default(0),
})
const source = z.object({
	id: z.uuid(),
	name: z.string(),
	url: z.string(),
	fingerprint: z.string().optional(),
	token: z.string(),
	receivedPointId: z.uuid().nullable().default(null),
	receivedAt: z.number().nullable().default(null),
})
const stateSchema = z.object({
	role: z.enum(["unconfigured", "send", "receive"]),
	name: z.string(),
	paused: z.boolean(),
	peers: z.array(peer),
	source: source.nullable(),
	invitation: z.object({ hash: z.string(), expiresAt: z.number() }).nullable(),
	locks: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.uuid()),
	links: z.record(z.uuid(), z.uuid()).default({}),
})
const pointSchema = recoveryMetadata.extend({
	id: z.uuid(),
	snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
	createdAt: z.number(),
	manifest: recoveryHeader,
	totalBytes: z.number().optional(),
	newBytes: z.number().optional(),
	fileCount: z.number().optional(),
})
const pairReply = z.object({
	protocol: z.literal(1),
	instanceId: z.uuid(),
	name: z.string(),
	token: z.string().min(32),
	repositoryKey: z.string().min(1),
})
export const pairingInput = z.object({
	code: z.string().min(32).max(256),
	instanceId: z.uuid(),
	name: z.string().trim().min(1).max(64),
})
export type SyncEngine = Awaited<ReturnType<typeof createSyncEngine>>

function digest(value: string) {
	return createHash("sha256").update(value).digest("hex")
}
function matches(value: string, expected: string) {
	const left = Buffer.from(digest(value), "hex")
	const right = Buffer.from(expected, "hex")
	return left.length === right.length && timingSafeEqual(left, right)
}

export function repositoryRoute(
	path: string,
	method: string,
): { path: string; lockId?: string } {
	const decoded = decodeURIComponent(path)
	if (
		!/^(?:config|(?:data|index|keys|snapshots|locks)(?:\/[a-f0-9]{64})?\/?)$/.test(
			decoded,
		)
	) {
		throw new BackupError(
			"invalid_repository_path",
			"The repository path is not allowed",
		)
	}
	const lock = /^locks\/([a-f0-9]{64})$/.exec(decoded)
	if (method === "GET" || method === "HEAD") return { path: decoded }
	if (lock && (method === "POST" || method === "DELETE"))
		return { path: decoded, lockId: lock[1] }
	throw new BackupError(
		"repository_read_only",
		"Peers cannot modify backup data",
	)
}

export async function createSyncEngine(options: {
	instanceId: string
	directory: string
	engine: BackupEngine
	localRepository: () => Repository
	listLocalPoints: () => Promise<RecoveryPoint[]>
	registerSource: (input: {
		id: string
		name: string
		recoveryKey: string
		source: Repository
	}) => Promise<Repository>
	withRepository: <T>(id: string, operation: () => Promise<T>) => Promise<T>
	onReceived?: (repositoryId: string) => Promise<void>
	sourceBusy?: () => boolean
	proxyFor?: (url: URL) => string | undefined
	rcloneBinary?: string
	processDirectory?: string
}) {
	const statePath = join(options.directory, "state.json")
	const state = await readJsonState(statePath, stateSchema, () =>
		stateSchema.parse({
			role: "unconfigured",
			name: "Hoardodile",
			paused: false,
			peers: [],
			source: null,
			invitation: null,
			locks: {},
		}),
	)
	await atomicWrite(statePath, JSON.stringify(state))
	let mutations: Promise<unknown> = Promise.resolve()
	const mutate = <T>(operation: () => Promise<T> | T): Promise<T> => {
		const run = mutations.then(async () => {
			const result = await operation()
			await atomicWrite(statePath, JSON.stringify(state))
			return result
		})
		mutations = run.catch(() => {})
		return run
	}
	const client = createPeerClient({ proxyFor: options.proxyFor })
	let transport: Awaited<ReturnType<typeof serveRestic>> | undefined
	let starting: Promise<Awaited<ReturnType<typeof serveRestic>>> | undefined
	let receiving: AbortController | undefined
	const sessions = new Map<
		string,
		{ peerId: string; touchedAt: number; active: number }
	>()
	const responses = new Map<string, Set<IncomingMessage>>()
	async function localTransport() {
		if (transport?.isAlive()) return transport
		starting ??= serveRestic({
			repository: options.localRepository().path,
			binary: options.rcloneBinary,
			processDirectory:
				options.processDirectory ?? join(options.directory, "processes"),
		})
		try {
			transport = await starting
			return transport
		} finally {
			starting = undefined
		}
	}
	function authorize(authorization: string | undefined) {
		if (state.role !== "send" || state.paused)
			throw new BackupError("sender_unavailable", "The sender is unavailable")
		const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
		const match = token
			? state.peers.find((entry) => matches(token, entry.tokenHash))
			: undefined
		if (!match)
			throw new BackupError("peer_unauthorized", "Peer authorization failed")
		match.lastSeenAt = Date.now()
		return match
	}
	async function removeOwnedLocks(peerId: string) {
		const ids = Object.entries(state.locks)
			.filter(([, owner]) => owner === peerId)
			.map(([id]) => id)
		if (!ids.length) return
		const local = await localTransport()
		for (const id of ids) {
			const response = await loopbackRequest(
				new URL(`locks/${id}`, local.url),
				{ method: "DELETE" },
			)
			response.resume()
			if ((response.statusCode ?? 500) < 400 || response.statusCode === 404)
				await mutate(() => {
					delete state.locks[id]
				})
		}
	}
	async function endSession(sessionId: string) {
		const session = sessions.get(sessionId)
		if (!session) return
		sessions.delete(sessionId)
		for (const response of responses.get(session.peerId) ?? [])
			response.destroy()
		await removeOwnedLocks(session.peerId)
	}
	const sweep = setInterval(() => {
		for (const [id, session] of sessions)
			if (!session.active && Date.now() - session.touchedAt > 10 * 60_000)
				void endSession(id).catch(() => {})
		for (const entry of state.peers) {
			if (
				Date.now() - entry.lastSeenAt > 60 * 60_000 &&
				![...sessions.values()].some((session) => session.peerId === entry.id)
			) {
				void removeOwnedLocks(entry.id).catch(() => {})
			}
		}
	}, 60_000)
	sweep.unref()

	return {
		getStatus() {
			return {
				role: state.role,
				name: state.name,
				paused: state.paused,
				peers: state.peers.map(({ tokenHash: _tokenHash, ...entry }) => entry),
				source: state.source
					? {
							id: state.source.id,
							name: state.source.name,
							url: state.source.url,
							fingerprint: state.source.fingerprint,
							receivedPointId: state.source.receivedPointId,
							receivedAt: state.source.receivedAt,
						}
					: null,
				links: { ...state.links },
				receiving: receiving !== undefined,
				activeTransfers: sessions.size,
			}
		},
		async configure(input: {
			role: z.infer<typeof stateSchema>["role"]
			name: string
			paused: boolean
		}) {
			await mutate(() => {
				if (input.role !== state.role && (state.source || state.peers.length))
					throw new BackupError(
						"paired_role",
						"Disconnect paired devices before changing roles",
					)
				state.role = stateSchema.shape.role.parse(input.role)
				state.name = z.string().trim().min(1).max(64).parse(input.name)
				state.paused = input.paused
				if (input.paused) receiving?.abort()
			})
		},
		async createInvitation() {
			return mutate(() => {
				if (state.role !== "send")
					throw new BackupError(
						"not_sender",
						"Only a sender can create pairing invitations",
					)
				options.localRepository()
				const code = randomBytes(32).toString("base64url")
				const expiresAt = Date.now() + 10 * 60_000
				state.invitation = { hash: digest(code), expiresAt }
				return { code, expiresAt, instanceId: options.instanceId }
			})
		},
		async acceptPairing(raw: unknown) {
			const input = pairingInput.parse(raw)
			return mutate(async () => {
				const invitation = state.invitation
				if (
					state.role !== "send" ||
					!invitation ||
					invitation.expiresAt < Date.now() ||
					!matches(input.code, invitation.hash)
				) {
					throw new BackupError(
						"invalid_invitation",
						"The pairing invitation is invalid or expired",
					)
				}
				if (input.instanceId === options.instanceId)
					throw new BackupError(
						"self_pairing",
						"A service cannot pair with itself",
					)
				if (state.peers.some((entry) => entry.id === input.instanceId))
					throw new BackupError(
						"already_paired",
						"Revoke the existing device before pairing again",
					)
				const repositoryKey = await options.engine.readRecoveryKey(
					options.localRepository(),
				)
				const token = randomBytes(32).toString("base64url")
				state.peers.push(
					peer.parse({
						id: input.instanceId,
						name: input.name,
						tokenHash: digest(token),
						lastSeenAt: Date.now(),
						receivedPointId: null,
						receivedAt: null,
					}),
				)
				state.invitation = null
				return {
					protocol: 1 as const,
					instanceId: options.instanceId,
					name: state.name,
					token,
					repositoryKey,
				}
			})
		},
		async connect(input: PeerAddress & { code: string }) {
			validatePeerAddress(input)
			return mutate(async () => {
				if (state.source || state.peers.length || state.role === "send")
					throw new BackupError(
						"already_paired",
						"Disconnect existing peers before connecting to a sender",
					)
				const result = pairReply.parse(
					await client.json(input, "api/sync/pair", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							code: input.code,
							instanceId: options.instanceId,
							name: state.name,
						}),
					}),
				)
				if (result.instanceId === options.instanceId)
					throw new BackupError(
						"self_pairing",
						"A service cannot pair with itself",
					)
				await atomicWrite(
					join(options.directory, "source-key"),
					result.repositoryKey,
				)
				state.source = source.parse({
					id: result.instanceId,
					name: result.name,
					url: input.url,
					fingerprint: input.fingerprint,
					token: result.token,
				})
				state.role = "receive"
			})
		},
		async disconnect() {
			receiving?.abort()
			await mutate(() => {
				for (const [record, id] of Object.entries(state.links))
					if (id === state.source?.id) delete state.links[record]
				state.source = null
				state.role = "unconfigured"
			})
		},
		async linkDevice(recordId: string, instanceId: string | null) {
			z.uuid().parse(recordId)
			await mutate(() => {
				if (instanceId === null) {
					delete state.links[recordId]
					return
				}
				z.uuid().parse(instanceId)
				if (
					state.source?.id !== instanceId &&
					!state.peers.some((entry) => entry.id === instanceId)
				)
					throw new BackupError(
						"peer_not_found",
						"The paired device is unavailable",
					)
				if (
					Object.entries(state.links).some(
						([record, peerId]) => record !== recordId && peerId === instanceId,
					)
				)
					throw new BackupError(
						"already_linked",
						"This service is already linked to another device record",
					)
				state.links[recordId] = instanceId
			})
		},
		async revoke(id: string) {
			z.uuid().parse(id)
			await mutate(() => {
				state.peers = state.peers.filter((entry) => entry.id !== id)
				for (const [record, peerId] of Object.entries(state.links))
					if (peerId === id) delete state.links[record]
			})
			for (const [key, session] of sessions)
				if (session.peerId === id) await endSession(key)
			await removeOwnedLocks(id)
		},
		async catalog(authorization: string | undefined) {
			authorize(authorization)
			return options.listLocalPoints()
		},
		async begin(authorization: string | undefined) {
			const entry = authorize(authorization)
			if (
				options.sourceBusy?.() ||
				sessions.size >= 2 ||
				[...sessions.values()].some((session) => session.peerId === entry.id)
			)
				return { available: false as const }
			const id = randomUUID()
			sessions.set(id, { peerId: entry.id, touchedAt: Date.now(), active: 0 })
			return { available: true as const, sessionId: id }
		},
		async end(authorization: string | undefined, id: string) {
			const entry = authorize(authorization)
			if (sessions.get(id)?.peerId !== entry.id)
				throw new BackupError(
					"invalid_session",
					"The transfer session is unavailable",
				)
			await endSession(id)
		},
		async acknowledge(authorization: string | undefined, pointId: string) {
			const entry = authorize(authorization)
			z.uuid().parse(pointId)
			const point = (await options.listLocalPoints()).find(
				(value) => value.id === pointId,
			)
			if (!point)
				throw new BackupError(
					"point_not_found",
					"The recovery point is unavailable",
				)
			await mutate(() => {
				if (point.createdAt >= entry.receivedDataAt) {
					entry.receivedPointId = pointId
					entry.receivedAt = Date.now()
					entry.receivedDataAt = point.createdAt
				}
			})
		},
		async proxyRepository(input: {
			authorization?: string
			sessionId?: string
			path: string
			method: string
			headers: IncomingHttpHeaders
			body?: Readable
		}) {
			const entry = authorize(input.authorization)
			const session = input.sessionId
				? sessions.get(input.sessionId)
				: undefined
			if (!session || session.peerId !== entry.id)
				throw new BackupError("invalid_session", "The transfer session expired")
			const route = repositoryRoute(input.path, input.method)
			const local = await localTransport()
			if (route.lockId)
				await mutate(async () => {
					const owner = state.locks[route.lockId!]
					if (
						(input.method === "DELETE" && owner !== entry.id) ||
						(owner && owner !== entry.id)
					)
						throw new BackupError(
							"lock_owner",
							"A peer may only change its own locks",
						)
					if (input.method === "POST" && !owner) {
						const existing = await loopbackRequest(
							new URL(route.path, local.url),
							{ method: "HEAD" },
						)
						existing.resume()
						if (existing.statusCode !== 404)
							throw new BackupError(
								"lock_owner",
								"A peer cannot claim an existing repository lock",
							)
					}
					if (input.method === "POST") state.locks[route.lockId!] = entry.id
				})
			session.touchedAt = Date.now()
			session.active++
			try {
				const response = await loopbackRequest(new URL(route.path, local.url), {
					method: input.method,
					headers: {
						accept: input.headers.accept,
						range: input.headers.range,
						"content-type": input.headers["content-type"],
					},
					body: input.body,
				})
				const active = responses.get(entry.id) ?? new Set<IncomingMessage>()
				responses.set(entry.id, active)
				active.add(response)
				response.once("close", () => {
					active.delete(response)
					session.active--
					session.touchedAt = Date.now()
					entry.lastSeenAt = Date.now()
				})
				if (
					route.lockId &&
					input.method === "DELETE" &&
					(response.statusCode ?? 500) < 400
				)
					await mutate(() => {
						delete state.locks[route.lockId!]
					})
				return response
			} catch (error) {
				session.active--
				throw error
			}
		},
		async receive(context: JobContext) {
			if (receiving)
				throw new BackupError(
					"receive_busy",
					"A receive operation is already running",
				)
			const upstream = state.source
			if (state.role !== "receive" || state.paused || !upstream)
				throw new BackupError(
					"receiver_unavailable",
					"No active sender is configured",
				)
			receiving = new AbortController()
			const signal = AbortSignal.any([context.signal, receiving.signal])
			const headers = {
				authorization: `Bearer ${upstream.token}`,
				"content-type": "application/json",
			}
			let sessionId: string | undefined
			let networkBytes = 0
			let bridge: ReturnType<typeof createServer> | undefined
			try {
				while (!sessionId) {
					signal.throwIfAborted()
					const result = z
						.union([
							z.object({ available: z.literal(false) }),
							z.object({ available: z.literal(true), sessionId: z.uuid() }),
						])
						.parse(
							await client.json(upstream, "api/sync/begin", {
								method: "POST",
								headers,
								body: "{}",
								signal,
							}),
						)
					if (result.available) sessionId = result.sessionId
					else {
						context.progress({ phase: "waiting-for-sender" })
						await delay(10_000, undefined, { signal })
					}
				}
				const points = z
					.array(pointSchema)
					.parse(
						await client.json(upstream, "api/sync/points", { headers, signal }),
					)
				const secret = randomBytes(32).toString("hex")
				const transferHeaders = {
					authorization: headers.authorization,
					"x-hoardodile-transfer": sessionId,
				}
				bridge = createServer(async (request, reply) => {
					try {
						if (!request.url?.startsWith(`/${secret}/`)) {
							reply.writeHead(403).end()
							return
						}
						const path = request.url.slice(secret.length + 2)
						repositoryRoute(path, request.method ?? "GET")
						const remote = await client.send(
							upstream,
							`api/sync/repository/${path}`,
							{
								method: request.method,
								headers: {
									...transferHeaders,
									accept: request.headers.accept,
									range: request.headers.range,
									"content-type": request.headers["content-type"],
								},
								body: request,
								signal,
							},
						)
						reply.writeHead(remote.statusCode ?? 502, responseHeaders(remote))
						remote.on("data", (chunk: Buffer) => {
							networkBytes += chunk.length
							context.progress({ networkBytes })
						})
						await pipeline(remote, reply)
					} catch {
						if (!reply.headersSent) reply.writeHead(502)
						reply.end()
					}
				})
				await new Promise<void>((resolve, reject) => {
					bridge!.once("error", reject)
					bridge!.listen(0, "127.0.0.1", resolve)
				})
				const address = bridge.address()
				if (!address || typeof address === "string")
					throw new Error("The transfer bridge did not start")
				const sourceRepository: Repository = {
					id: upstream.id,
					path: `rest:http://127.0.0.1:${address.port}/${secret}/`,
					passwordFile: join(options.directory, "source-key"),
				}
				const destination = await options.registerSource({
					id: upstream.id,
					name: upstream.name,
					recoveryKey: "",
					source: sourceRepository,
				})
				const existing = new Set(
					(
						await options.withRepository(destination.id, () =>
							options.engine.listRecoveryPoints(destination),
						)
					).map((point) => point.id),
				)
				const received: string[] = []
				for (const point of points.sort((a, b) => b.createdAt - a.createdAt)) {
					signal.throwIfAborted()
					if (!existing.has(point.id)) {
						context.progress({ phase: "receiving", pointId: point.id })
						await options.withRepository(destination.id, () =>
							options.engine.copy(destination, {
								source: sourceRepository,
								snapshotId: point.snapshotId,
								signal,
								onProgress: context.progress,
							}),
						)
						await options.onReceived?.(destination.id)
						received.push(point.id)
					}
					await client.json(upstream, "api/sync/acknowledge", {
						method: "POST",
						headers,
						body: JSON.stringify({ pointId: point.id }),
						signal,
					})
					if (point.id === points[0]?.id) {
						await mutate(() => {
							if (state.source?.id === upstream.id) {
								state.source.receivedPointId = point.id
								state.source.receivedAt = Date.now()
							}
						})
					}
				}
				return { received, sourceId: upstream.id, networkBytes }
			} finally {
				if (bridge) {
					bridge.closeAllConnections()
					await new Promise<void>((resolve) => bridge!.close(() => resolve()))
				}
				if (sessionId)
					await client
						.json(upstream, "api/sync/end", {
							method: "POST",
							headers,
							body: JSON.stringify({ sessionId }),
						})
						.catch(() => {})
				receiving = undefined
			}
		},
		async close() {
			clearInterval(sweep)
			receiving?.abort()
			client.close()
			for (const id of [...sessions.keys()])
				await endSession(id).catch(() => {})
			await transport?.close()
		},
	}
}

function responseHeaders(
	response: IncomingMessage,
): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {}
	for (const name of [
		"content-type",
		"content-length",
		"content-range",
		"accept-ranges",
		"etag",
	]) {
		const value = response.headers[name]
		if (value !== undefined) result[name] = value
	}
	return result
}
