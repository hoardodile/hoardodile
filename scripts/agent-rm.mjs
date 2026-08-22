#!/usr/bin/env node
/**
 * Remove agent worktrees created by `pnpm agent:wt`, along with their branches.
 *
 *   pnpm agent:rm                        list agent worktrees and pick one
 *   pnpm agent:rm <task-name>            remove that worktree + agent/<task-name>
 *   pnpm agent:rm --all                  walk through every agent worktree
 *   ... --force                          skip summaries and confirmations
 *
 * Dirty worktrees are skipped unless --force is given; locked ones are always
 * skipped. Branches are deleted with -D on purpose: agent branches are
 * squash-merged, so their commits never become ancestors of main and
 * `git branch -d` would always refuse.
 */

import { execFileSync } from "node:child_process"
import { rmSync } from "node:fs"
import readline from "node:readline"

import { listWorktrees } from "./lib/worktrees.mjs"

const args = process.argv.slice(2)
const force = args.includes("--force")
const all = args.includes("--all")
const name = args.find((a) => !a.startsWith("--"))

function git(args, options = {}) {
	return execFileSync("git", args, { encoding: "utf8", ...options }).trim()
}

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})
function ask(question) {
	return new Promise((resolve) => rl.question(question, resolve))
}

// Drop stale entries left behind when a worktree directory was deleted
// manually — their paths would crash `git -C <path> status` below.
git(["worktree", "prune"])

const entries = listWorktrees()
const [mainWorktree] = entries
// The main worktree is always first and is never a removal candidate, even
// when its checked-out branch happens to match agent/*.
const candidates = entries
	.slice(1)
	.filter((e) => e.branch?.startsWith("agent/"))

async function removeOne(target) {
	if (target.locked) {
		console.error(
			`skipping locked worktree: ${target.path} (run \`git worktree unlock "${target.path}"\` first)`,
		)
		return
	}
	const dirty = git(["-C", target.path, "status", "--porcelain"])
	if (dirty && !force) {
		console.error(
			`skipping ${target.branch} — uncommitted changes:\n${dirty}\n(re-run with --force to remove anyway)`,
		)
		return
	}
	if (!force) {
		let log
		try {
			log = git([
				"-C",
				mainWorktree.path,
				"log",
				`main..${target.branch}`,
				"--oneline",
			])
		} catch {
			log = "(could not list commits)"
		}
		console.log(
			`\nworktree: ${target.path}\nbranch:   ${target.branch}\n\n${log || "(no commits beyond main)"}\n`,
		)
		const answer = await ask(
			`Remove worktree and delete ${target.branch}? [y/N] `,
		)
		if (answer.trim().toLowerCase() !== "y") {
			console.log("skipped")
			return
		}
	}
	// Delete the directory with Node's fs instead of `git worktree remove`:
	// git walks every file and, without core.longpaths, fails with "Filename
	// too long" once a path exceeds Windows' 260-char limit (long task name +
	// deep node_modules paths). `git worktree prune` then drops the stale
	// administrative entry.
	rmSync(target.path, { recursive: true, force: true, maxRetries: 5 })
	git(["worktree", "prune"])
	execFileSync(
		"git",
		["-C", mainWorktree.path, "branch", "-D", target.branch],
		{
			stdio: "inherit",
		},
	)
	console.log(`removed ${target.path} and deleted ${target.branch}`)
}

if (all) {
	if (candidates.length === 0) {
		console.log("no agent worktrees found")
		process.exit(0)
	}
	for (const target of candidates) {
		await removeOne(target)
	}
} else {
	let target
	if (name) {
		target = candidates.find((e) => e.branch === `agent/${name}`)
		if (!target) {
			console.error(`no agent worktree found for "${name}"`)
			for (const e of candidates) {
				console.error(`  ${e.branch}  ${e.path}`)
			}
			process.exit(1)
		}
	} else {
		if (candidates.length === 0) {
			console.log("no agent worktrees found")
			process.exit(0)
		}
		for (const [i, e] of candidates.entries()) {
			console.log(`  ${i + 1}) ${e.branch}  ${e.path}`)
		}
		const answer = await ask(
			`Remove which? [1-${candidates.length}, empty to cancel] `,
		)
		const idx = Number.parseInt(answer, 10)
		if (!idx || idx < 1 || idx > candidates.length) {
			console.log("cancelled")
			process.exit(0)
		}
		target = candidates[idx - 1]
	}
	await removeOne(target)
}
rl.close()
