import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { spawnManagedProcess } from "./managed-process.ts"
import { BackupError } from "./types.ts"

export type BinaryCommand = {
	binary: string
	args: readonly string[]
	cwd?: string
	env?: NodeJS.ProcessEnv
	signal?: AbortSignal
	onJson?: (event: unknown) => void
	capture?: boolean
	leaseDirectory?: string
}
export type BinaryResult = { stdout: string }
export type BinaryRunner = (command: BinaryCommand) => Promise<BinaryResult>

export function resolveBinary(options: {
	name: "restic" | "rclone"
	env?: NodeJS.ProcessEnv
	load?: () => unknown
}): string {
	const env = options.env ?? process.env
	const override = env[`${options.name.toUpperCase()}_BIN_PATH`]
	if (override?.trim()) return override
	try {
		const value: unknown = options.load
			? options.load()
			: createRequire(import.meta.url)(`@hoardodile/${options.name}-bin`)
		if (typeof value === "string" && value) return value
	} catch {
		/* PATH remains available for installations without optional packages. */
	}
	return options.name
}

/** Settle on close, never on abort: callers must not unlock live files early. */
export const runBinary: BinaryRunner = (command) =>
	new Promise((resolve, reject) => {
		if (command.signal?.aborted) {
			reject(new BackupError("cancelled", "The operation was cancelled"))
			return
		}
		const environment = { ...process.env }
		for (const key of Object.keys(environment))
			if (key.startsWith("RESTIC_")) delete environment[key]
		const child = command.leaseDirectory
			? spawnManagedProcess({
					binary: command.binary,
					args: command.args,
					cwd: command.cwd,
					env: { ...environment, ...command.env },
					directory: command.leaseDirectory,
				})
			: spawn(command.binary, [...command.args], {
					cwd: command.cwd,
					env: { ...environment, ...command.env },
					shell: false,
					windowsHide: true,
					stdio: ["ignore", "pipe", "pipe"],
				})
		if (!child.stdout || !child.stderr) {
			reject(
				new BackupError(
					"binary_unavailable",
					"The process output pipes are unavailable",
				),
			)
			return
		}
		let stdout = ""
		let line = ""
		let failure: Error | undefined
		let forceKill: ReturnType<typeof setTimeout> | undefined
		let cancelled = false
		const stop = () => {
			if (command.leaseDirectory && child.connected)
				child.send({ kind: "cancel" }, () => {})
			else child.kill("SIGTERM")
			forceKill ??= setTimeout(() => child.kill("SIGKILL"), 10_000)
			forceKill.unref()
		}
		const abort = () => {
			cancelled = true
			stop()
		}
		command.signal?.addEventListener("abort", abort, { once: true })
		const parseLine = (value: string) => {
			if (!command.onJson || !value.trim()) return
			// Some Restic commands mix human progress lines with JSON records.
			if (!value.trimStart().startsWith("{")) return
			try {
				const event: unknown = JSON.parse(value)
				command.onJson(event)
			} catch (error) {
				failure =
					error instanceof Error ? error : new Error("Invalid binary output")
				stop()
			}
		}
		child.stdout.setEncoding("utf8")
		child.stdout.on("data", (chunk: string) => {
			if (command.capture !== false) {
				stdout += chunk
				if (stdout.length > 64 * 1024 * 1024) {
					failure = new BackupError(
						"output_limit",
						"The command output exceeded its limit",
					)
					stop()
				}
			}
			if (!command.onJson) return
			line += chunk
			let end = line.indexOf("\n")
			while (end >= 0) {
				parseLine(line.slice(0, end))
				line = line.slice(end + 1)
				end = line.indexOf("\n")
			}
		})
		// Native stderr can contain repository credentials and absolute source paths.
		child.stderr.resume()
		child.on("error", () => {
			failure = new BackupError(
				"binary_unavailable",
				"The required binary could not be started",
			)
		})
		child.on("close", (code) => {
			command.signal?.removeEventListener("abort", abort)
			if (forceKill) clearTimeout(forceKill)
			if (line.trim()) parseLine(line)
			if (cancelled)
				reject(new BackupError("cancelled", "The operation was cancelled"))
			else if (failure) reject(failure)
			else if (code !== 0)
				reject(
					new BackupError(
						code === 3 ? "incomplete_backup" : "command_failed",
						`The command failed with exit code ${code ?? "unknown"}`,
					),
				)
			else resolve({ stdout })
		})
	})
