import { createHash, randomBytes } from "node:crypto"
import {
	linkSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { setTimeout as delay } from "node:timers/promises"
import { WORKSPACE_ROOT } from "./workspace.mjs"

async function bindPort(host, port) {
	const server = createServer()
	try {
		await new Promise((resolve, reject) => {
			server.once("error", reject)
			server.listen({ host, port }, resolve)
		})
		return server.address().port
	} finally {
		if (server.listening) await new Promise((resolve) => server.close(resolve))
	}
}

async function isSharedServer(port, token) {
	try {
		const response = await fetch(
			`http://127.0.0.1:${port}/api/internal/auth-configured`,
			{
				headers: { "x-shutdown-token": token },
				redirect: "error",
				signal: AbortSignal.timeout(1000),
			},
		)
		if (!response.ok) return false
		const value = await response.json()
		return (
			typeof value.configured === "boolean" &&
			typeof value.weakPassword === "boolean"
		)
	} catch {
		return false
	}
}

/** Serialize launchers without blocking either Node event loop during port probes. */
async function acquirePortLock(path) {
	const db = new DatabaseSync(path)
	db.exec("PRAGMA busy_timeout = 0")
	const deadline = Date.now() + 10_000
	try {
		for (;;) {
			let acquired = false
			try {
				db.exec("BEGIN EXCLUSIVE")
				acquired = true
				db.exec(
					"CREATE TABLE IF NOT EXISTS allocation_lock (id INTEGER PRIMARY KEY)",
				)
				return () => {
					try {
						db.exec("COMMIT")
					} finally {
						db.close()
					}
				}
			} catch (error) {
				if (acquired) db.exec("ROLLBACK")
				if (![5, 6].includes(error.errcode) || Date.now() >= deadline)
					throw error
				await delay(25)
			}
		}
	} catch (error) {
		db.close()
		throw error
	}
}

function validPort(port) {
	return Number.isInteger(port) && port > 0 && port <= 65535
}

async function selectPort({ previous, preferredPort, host, token }) {
	if (previous && (await isSharedServer(previous.port, token)))
		return { port: previous.port, running: true }
	const candidates = [
		...new Set([
			...(previous?.preferredPort === preferredPort && previous.host === host
				? [previous.port]
				: []),
			preferredPort,
			0,
		]),
	]
	for (const port of candidates) {
		try {
			return { port: await bindPort(host, port), running: false }
		} catch (error) {
			if (port === 0 || !["EADDRINUSE", "EACCES"].includes(error.code))
				throw error
			if (await isSharedServer(port, token)) return { port, running: true }
		}
	}
	throw new Error("No development API port is available")
}

/** Both dev launchers address one backend; only pnpm dev owns its process. */
export async function developmentBackend(env = process.env) {
	const ports = JSON.parse(
		readFileSync(new URL("./dev-ports.json", import.meta.url), "utf8"),
	)
	const preferredPort = Number(env.PORT ?? ports.api)
	if (!validPort(preferredPort)) throw new Error("Invalid development API port")
	const host = env.HOST ?? "0.0.0.0"
	const storageRoot = resolve(
		WORKSPACE_ROOT,
		env.STORAGE_ROOT ?? "tmp/dev-storage",
	)
	const stateRoot = join(WORKSPACE_ROOT, "tmp", "dev-backend")
	mkdirSync(stateRoot, { recursive: true })
	const identity = createHash("sha256")
		.update(storageRoot)
		.digest("hex")
		.slice(0, 24)
	const tokenPath = join(stateRoot, `${identity}.token`)
	const staged = `${tokenPath}.${process.pid}.${randomBytes(8).toString("hex")}`
	writeFileSync(staged, randomBytes(32).toString("hex"), {
		flag: "wx",
		mode: 0o600,
	})
	try {
		linkSync(staged, tokenPath)
	} catch (error) {
		if (error.code !== "EEXIST") throw error
	} finally {
		unlinkSync(staged)
	}
	const token = readFileSync(tokenPath, "utf8")
	if (!/^[a-f0-9]{64}$/.test(token))
		throw new Error("Invalid development control token")
	const addressFile = join(stateRoot, `${identity}.address.json`)
	const unlock = await acquirePortLock(
		join(stateRoot, `${identity}.port-lock.sqlite`),
	)
	try {
		let previous
		try {
			const record = JSON.parse(readFileSync(addressFile, "utf8"))
			if (
				record.version === 1 &&
				record.storageRoot === storageRoot &&
				validPort(record.port)
			)
				previous = record
		} catch (error) {
			if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
				throw error
		}
		const { port, running } = await selectPort({
			previous,
			preferredPort,
			host,
			token,
		})
		const record =
			running && previous?.port === port
				? previous
				: { version: 1, storageRoot, port, preferredPort, host }
		const temporary = `${addressFile}.${process.pid}.tmp`
		writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
		renameSync(temporary, addressFile)
		return {
			url: `http://127.0.0.1:${port}/`,
			port,
			preferredPort,
			storageRoot,
			token,
			addressFile,
			running,
		}
	} finally {
		unlock()
	}
}
