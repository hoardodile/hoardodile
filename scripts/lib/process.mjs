import { spawnSync } from "node:child_process"

/**
 * Shared child-process helpers. Windows .cmd shims (pnpm, etc.) cannot be
 * spawned without a shell (Node's batch-file mitigation), so command
 * execution goes through the shell on win32 only.
 */

/** Whether .cmd shims must be resolved via a shell. */
export const needsShell = process.platform === "win32"

/**
 * Run a command synchronously and throw on non-zero exit. Prints the
 * command first, inherits stdio by default (like `execSync` with
 * `stdio: "inherit"`).
 */
export function run(cmd, args, opts = {}) {
	console.log(`> ${cmd} ${args.join(" ")}`)
	const result = spawnSync(cmd, args, {
		stdio: "inherit",
		shell: needsShell,
		...opts,
	})
	if (result.status !== 0) {
		throw new Error(
			`command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`,
		)
	}
}

/**
 * Kill a process tree: `taskkill /T` on Windows, the process group on
 * POSIX. Silently tolerates already-dead processes.
 */
export function killTree(pid) {
	if (needsShell) {
		spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
			stdio: "ignore",
		})
		return
	}
	try {
		process.kill(-pid, "SIGKILL")
	} catch {
		try {
			process.kill(pid, "SIGKILL")
		} catch {
			// already dead
		}
	}
}
