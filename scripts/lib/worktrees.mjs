import { execFileSync } from "node:child_process"

/**
 * Parsed `git worktree list --porcelain` entries: `{ path, branch?, locked? }`.
 * The main worktree is always the first entry.
 */
export function listWorktrees() {
	const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
		encoding: "utf8",
	}).trim()
	const entries = []
	let current = null
	for (const line of out.split("\n")) {
		if (line.startsWith("worktree ")) {
			current = { path: line.slice("worktree ".length) }
			entries.push(current)
		} else if (current && line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length).replace("refs/heads/", "")
		} else if (current && line === "locked") {
			current.locked = true
		}
	}
	return entries
}
