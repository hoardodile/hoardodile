import { createRequire } from "node:module"
import {
	BackupError,
	resolveBinary,
	spawnManagedProcess,
} from "@hoardodile/backup"

/** Expose a local repository only to the application's authenticated proxy. */
export async function serveRestic(options: {
	repository: string
	binary?: string
	processDirectory: string
}) {
	const binary =
		options.binary ??
		resolveBinary({
			name: "rclone",
			load: () => createRequire(import.meta.url)("@hoardodile/rclone-bin"),
		})
	const env = { ...process.env }
	for (const key of Object.keys(env))
		if (key.startsWith("RCLONE_")) delete env[key]
	const child = spawnManagedProcess({
		binary,
		args: [
			"serve",
			"restic",
			options.repository,
			"--addr",
			"127.0.0.1:0",
			"--log-level",
			"INFO",
		],
		env,
		directory: options.processDirectory,
	})
	const closed = new Promise<void>((resolve) =>
		child.once("close", () => resolve()),
	)
	let force: ReturnType<typeof setTimeout> | undefined
	const close = async () => {
		if (child.exitCode !== null || child.signalCode !== null) return
		if (child.connected) child.send({ kind: "cancel" }, () => {})
		else child.kill("SIGTERM")
		force = setTimeout(() => child.kill("SIGKILL"), 10_000)
		force.unref()
		await closed
		clearTimeout(force)
	}
	try {
		const url = await new Promise<URL>((resolve, reject) => {
			const timeout = setTimeout(
				() =>
					reject(
						new BackupError(
							"transport_timeout",
							"The backup transport did not start",
						),
					),
				15_000,
			)
			let buffer = ""
			const consume = (chunk: Buffer) => {
				buffer = (buffer + chunk.toString("utf8")).slice(-8192)
				const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d+)/)
				if (match) {
					clearTimeout(timeout)
					resolve(new URL(match[0]))
				}
			}
			child.stdout?.on("data", consume)
			child.stderr?.on("data", consume)
			child.once("error", () => {
				clearTimeout(timeout)
				reject(
					new BackupError("binary_unavailable", "Rclone could not be started"),
				)
			})
			child.once("close", () => {
				clearTimeout(timeout)
				reject(
					new BackupError("transport_closed", "The backup transport stopped"),
				)
			})
		})
		return {
			url,
			close,
			isAlive: () => child.exitCode === null && child.signalCode === null,
		}
	} catch (error) {
		await close()
		throw error
	}
}
