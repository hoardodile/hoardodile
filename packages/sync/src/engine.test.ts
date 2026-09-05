import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
	atomicWrite,
	createBackupEngine,
	type RecoveryManifest,
	type Repository,
	sha256File,
} from "@hoardodile/backup"
import forge from "node-forge"
import { afterEach, describe, expect, it } from "vitest"
import { createSyncEngine, repositoryRoute, type SyncEngine } from "./engine.ts"
import { createPeerClient } from "./network.ts"

const roots: string[] = []
const engines: SyncEngine[] = []
const servers: Server[] = []
afterEach(async () => {
	for (const engine of engines.splice(0)) await engine.close()
	for (const server of servers.splice(0)) {
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

function certificate() {
	const keys = forge.pki.rsa.generateKeyPair(2048)
	const cert = forge.pki.createCertificate()
	cert.publicKey = keys.publicKey
	cert.serialNumber = "01"
	cert.validity.notBefore = new Date(Date.now() - 60_000)
	cert.validity.notAfter = new Date(Date.now() + 86400_000)
	cert.setSubject([{ name: "commonName", value: "localhost" }])
	cert.setIssuer(cert.subject.attributes)
	cert.setExtensions([
		{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] },
	])
	cert.sign(keys.privateKey, forge.md.sha256.create())
	return {
		key: forge.pki.privateKeyToPem(keys.privateKey),
		cert: forge.pki.certificateToPem(cert),
		fingerprint: createHash("sha256")
			.update(
				Buffer.from(
					forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
					"binary",
				),
			)
			.digest("hex"),
	}
}

describe("one-way backup sync", () => {
	it("rejects write and traversal routes", () => {
		for (const path of [
			"../config",
			"data/%2e%2e/config",
			"%252e%252e/config",
			"config?other=true",
			"data/anything",
		]) {
			expect(() => repositoryRoute(path, "GET")).toThrow()
		}
		expect(() => repositoryRoute("config", "POST")).toThrow()
		expect(() => repositoryRoute(`data/${"a".repeat(64)}`, "DELETE")).toThrow()
	})
	it("pairs over pinned TLS and copies a real restic snapshot through rclone without editing the receiver library", async () => {
		const root = await mkdtemp(join(tmpdir(), "hd-sync-test-"))
		roots.push(root)
		const backup = createBackupEngine({ cacheDir: join(root, "cache") })
		const ownKey = join(root, "key")
		await atomicWrite(ownKey, "test-source-password")
		const repo: Repository = {
			id: "local",
			path: join(root, "repo"),
			passwordFile: ownKey,
		}
		await backup.initializeRepository(repo)
		const library = join(root, "source")
		await mkdir(join(library, "versions", "1"), { recursive: true })
		const database = join(library, "versions", "1", "app.sqlite")
		await writeFile(database, "checkpoint")
		await writeFile(
			join(library, "versions", "1", "media.bin"),
			randomBytes(65536),
		)
		const senderId = randomUUID()
		const manifest: RecoveryManifest = {
			formatVersion: 1,
			recoveryPointId: randomUUID(),
			libraryId: randomUUID(),
			instanceId: senderId,
			appVersion: "test",
			latestVersion: 1,
			createdAt: Date.now(),
			databasePath: "1/app.sqlite",
			databaseSha256: await sha256File(database),
			databaseSchema: "test",
			plugins: [],
		}
		await writeFile(
			join(library, "versions", "1", "recovery.json"),
			JSON.stringify(manifest),
		)
		await backup.createBackup(repo, {
			storageRoot: library,
			manifest,
			metadata: { kind: "manual", pinned: true, name: "Test", note: "" },
		})
		const destination: Repository = {
			id: senderId,
			path: join(root, "received"),
			passwordFile: join(root, "receiver-key"),
		}
		let sourceBusy = false
		const sender = await createSyncEngine({
			instanceId: senderId,
			directory: join(root, "sender-state"),
			sourceBusy: () => sourceBusy,
			engine: backup,
			localRepository: () => repo,
			listLocalPoints: () => backup.listRecoveryPoints(repo),
			registerSource: async () => {
				throw new Error("Sender must not receive")
			},
			withRepository: async (_id, operation) => operation(),
		})
		engines.push(sender)
		await sender.configure({ role: "send", name: "Sender", paused: false })
		const cert = certificate()
		const server = createServer(cert, async (req, reply) => {
			try {
				const path = req.url ?? ""
				if (path.startsWith("/api/sync/repository/")) {
					const upstream = await sender.proxyRepository({
						authorization: req.headers.authorization,
						sessionId: String(req.headers["x-hoardodile-transfer"] ?? ""),
						path: path.slice("/api/sync/repository/".length),
						method: req.method ?? "GET",
						headers: req.headers,
						body: req,
					})
					reply.writeHead(upstream.statusCode ?? 500, upstream.headers)
					await pipeline(upstream, reply)
					return
				}
				let raw = ""
				for await (const chunk of req) raw += String(chunk)
				const body: Record<string, string> = raw ? JSON.parse(raw) : {}
				let result: unknown
				if (path === "/api/sync/pair") result = await sender.acceptPairing(body)
				else if (path === "/api/sync/begin")
					result = await sender.begin(req.headers.authorization)
				else if (path === "/api/sync/points")
					result = await sender.catalog(req.headers.authorization)
				else if (path === "/api/sync/end") {
					await sender.end(req.headers.authorization, body.sessionId!)
					result = { ok: true }
				} else if (path === "/api/sync/acknowledge") {
					await sender.acknowledge(req.headers.authorization, body.pointId!)
					result = { ok: true }
				} else {
					reply.writeHead(404).end()
					return
				}
				reply.setHeader("content-type", "application/json")
				reply.end(JSON.stringify(result))
			} catch (error) {
				reply.writeHead(403).end(
					JSON.stringify({
						error: error instanceof Error ? error.message : "error",
					}),
				)
			}
		})
		servers.push(server)
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		const address = server.address()
		if (!address || typeof address === "string")
			throw new Error("Invalid test server address")
		let initialized = false
		const receiver = await createSyncEngine({
			instanceId: randomUUID(),
			directory: join(root, "receiver-state"),
			engine: backup,
			localRepository: () => {
				throw new Error("Receiver must not serve backups")
			},
			listLocalPoints: async () => [],
			registerSource: async (input) => {
				await atomicWrite(destination.passwordFile, "test-destination-password")
				if (!initialized)
					await backup.initializeRepository(destination, {
						source: input.source,
					})
				initialized = true
				return destination
			},
			withRepository: async (_id, operation) => operation(),
		})
		engines.push(receiver)
		const invitation = await sender.createInvitation()
		const endpoint = {
			url: `https://127.0.0.1:${address.port}`,
			fingerprint: cert.fingerprint,
		}
		const client = createPeerClient()
		await expect(
			client.json(
				{ ...endpoint, fingerprint: "0".repeat(64) },
				"api/sync/points",
			),
		).rejects.toThrow()
		client.close()
		await receiver.connect({ ...endpoint, code: invitation.code })
		const secondDestination = {
			...destination,
			path: join(root, "second-received"),
			passwordFile: join(root, "second-key"),
		}
		const second = await createSyncEngine({
			instanceId: randomUUID(),
			directory: join(root, "second-state"),
			engine: backup,
			localRepository: () => {
				throw new Error("Receiver must not serve backups")
			},
			listLocalPoints: async () => [],
			withRepository: async (_id, operation) => operation(),
			registerSource: async (input) => {
				await atomicWrite(secondDestination.passwordFile, "second-password")
				await backup.initializeRepository(secondDestination, {
					source: input.source,
				})
				return secondDestination
			},
		})
		engines.push(second)
		await second.connect({
			...endpoint,
			code: (await sender.createInvitation()).code,
		})
		const unrelated = join(root, "receiver-library.bin")
		await writeFile(unrelated, "local edits")
		const before = await sha256File(unrelated)
		await Promise.all([
			receiver.receive({
				signal: new AbortController().signal,
				jobId: randomUUID(),
				progress: () => {},
			}),
			second.receive({
				signal: new AbortController().signal,
				jobId: randomUUID(),
				progress: () => {},
			}),
		])
		expect((await backup.listRecoveryPoints(destination))[0]?.id).toBe(
			manifest.recoveryPointId,
		)
		expect(await sha256File(unrelated)).toBe(before)
		expect(sender.getStatus().peers[0]?.receivedPointId).toBe(
			manifest.recoveryPointId,
		)
		expect(sender.getStatus().activeTransfers).toBe(0)
		expect((await backup.listRecoveryPoints(secondDestination))[0]?.id).toBe(
			manifest.recoveryPointId,
		)
		await backup.updateMetadata(repo, manifest.recoveryPointId, {
			name: "Renamed",
			note: "Changed source metadata",
			kind: "manual",
			pinned: true,
		})
		const repeated = await receiver.receive({
			signal: new AbortController().signal,
			jobId: randomUUID(),
			progress: () => {},
		})
		expect(repeated.received).toEqual([])
		expect(await backup.listRecoveryPoints(destination)).toHaveLength(1)
		await sender.revoke(sender.getStatus().peers[0]!.id)
		await expect(
			receiver.receive({
				signal: new AbortController().signal,
				jobId: randomUUID(),
				progress: () => {},
			}),
		).rejects.toThrow()
		await expect(
			sender.acceptPairing({
				...invitation,
				instanceId: randomUUID(),
				name: "Other",
			}),
		).rejects.toThrow()
		const anotherInvitation = await sender.createInvitation()
		const peer = await sender.acceptPairing({
			code: anotherInvitation.code,
			instanceId: randomUUID(),
			name: "Lock ownership probe",
		})
		const authorization = `Bearer ${peer.token}`
		sourceBusy = true
		expect(await sender.begin(authorization)).toEqual({ available: false })
		sourceBusy = false
		const session = await sender.begin(authorization)
		assertSession(session)
		const lockId = "f".repeat(64)
		const foreignLock = join(repo.path, "locks", lockId)
		await writeFile(foreignLock, "external lock")
		try {
			await expect(
				sender.proxyRepository({
					authorization,
					sessionId: session.sessionId,
					path: `locks/${lockId}`,
					method: "POST",
					headers: { "content-type": "application/octet-stream" },
					body: Readable.from("replacement"),
				}),
			).rejects.toMatchObject({ code: "lock_owner" })
			await sender.end(authorization, session.sessionId)
			expect(await readFile(foreignLock, "utf8")).toBe("external lock")
		} finally {
			await rm(foreignLock, { force: true })
		}
	}, 120_000)
})

function assertSession(value: {
	available: boolean
	sessionId?: string
}): asserts value is { available: true; sessionId: string } {
	if (!value.available || !value.sessionId)
		throw new Error("The test transfer session did not start")
}
