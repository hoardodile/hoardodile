#!/usr/bin/env node
/**
 * Create an isolated git worktree for a concurrent agent.
 *
 *   pnpm agent:wt <task-name>
 *
 * Idempotent: reuses the worktree if one already exists for agent/<task-name>,
 * or attaches a fresh worktree to the existing branch. Drops you into a shell
 * inside the worktree (`exit` to come back); start any agent CLI there.
 * Cleanup after the branch has been squash-merged by the user:
 *
 *   pnpm agent:rm <task-name>
 */

import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, existsSync } from "node:fs"
import path from "node:path"

import { listWorktrees } from "./lib/worktrees.mjs"

const name = process.argv[2]
if (!name) {
	console.error("usage: pnpm agent:wt <task-name>")
	process.exit(1)
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	encoding: "utf8",
}).trim()
const branch = `agent/${name}`

const existing = listWorktrees().find((e) => e.branch === branch)
let wt
if (existing) {
	wt = existing.path
	console.log(`reusing existing worktree for ${branch}: ${wt}`)
} else {
	wt = path.join(path.dirname(root), `hoardodile-${name}`)
	const branchExists =
		spawnSync("git", ["show-ref", "--verify", `refs/heads/${branch}`], {
			stdio: "ignore",
		}).status === 0
	const addArgs = branchExists
		? ["worktree", "add", wt, branch]
		: ["worktree", "add", wt, "-b", branch]
	execFileSync("git", addArgs, { stdio: "inherit" })
}

// Windows: .cmd shims can't be spawned without a shell (Node batch-file
// mitigation), so let cmd.exe resolve pnpm there.
const install =
	process.platform === "win32"
		? spawnSync("pnpm install", { cwd: wt, stdio: "inherit", shell: true })
		: spawnSync("pnpm", ["install"], { cwd: wt, stdio: "inherit" })
if (install.error) {
	console.error(`could not run pnpm install: ${install.error.message}`)
	console.error(
		`worktree was created at ${wt} — run \`pnpm install\` there manually`,
	)
	process.exit(1)
}
if (install.status !== 0) {
	process.exit(install.status ?? 1)
}

// `.env` is gitignored, so fresh worktrees lack it — copy it over so
// `pnpm dev` (scripts/dev.mjs) picks up the same local config.
const mainEnv = path.join(root, ".env")
const wtEnv = path.join(wt, ".env")
if (root !== wt && existsSync(mainEnv) && !existsSync(wtEnv)) {
	copyFileSync(mainEnv, wtEnv)
	console.log("copied .env into the worktree")
}

// Pick the shell the user is most likely running. PSModulePath exists
// machine-wide on Windows, so an explicit SHELL (Git Bash/MSYS) wins.
function loginShell() {
	if (process.platform !== "win32") {
		return process.env.SHELL ?? "sh"
	}
	if (process.env.SHELL?.includes("bash")) {
		return "bash"
	}
	if (process.env.PSModulePath) {
		return "powershell.exe"
	}
	return process.env.ComSpec ?? "cmd.exe"
}

console.log(`\nWorktree ready on branch ${branch}: ${wt}`)
if (process.stdout.isTTY) {
	console.log("dropping you into a shell there — `exit` to come back")
	spawnSync(loginShell(), [], { cwd: wt, stdio: "inherit" })
} else {
	console.log(`  cd "${wt}"`)
}
console.log("When done, report the branch name for squash-merging.")
