#!/usr/bin/env node
/**
 * Validates commit messages against the Conventional Commits format, which
 * release-it relies on to generate the changelog and pick version bumps.
 *
 * Zero-dependency replacement for commitlint, adapted from hoardodile's
 * scripts/verify-commit.mjs. Rules match the old @commitlint/config-conventional
 * setup: a conventional header with one of the standard types, max 100 chars.
 *
 * Usage:
 *   node scripts/verify-commit.mjs <commit-msg-file>
 *
 * lefthook's commit-msg hook passes the message file path as {1}.
 */

import { readFileSync } from "node:fs"
import { styleText } from "node:util"

const msgPath = process.argv[2] || ".git/COMMIT_EDITMSG"
const header = readFileSync(msgPath, "utf-8").split("\n", 1)[0].trim()

const COMMIT_RE =
	/^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\(.+\))?!?: .+/

if (!COMMIT_RE.test(header) || header.length > 100) {
	console.error()
	console.error(
		`  ${styleText(["bgRed", "white"], " ERROR ")} ${styleText("red", "invalid commit message format.")}\n\n` +
			styleText(
				"red",
				"  Proper commit message format is required for automated changelog generation. Examples:\n\n",
			) +
			`    ${styleText("green", "feat(server): support out-of-tree plugin development")}\n` +
			`    ${styleText("green", "fix(web): abort stale query when switching libraries")}\n\n` +
			styleText("red", "  See CONTRIBUTING.md for more details.\n"),
	)
	process.exit(1)
}
