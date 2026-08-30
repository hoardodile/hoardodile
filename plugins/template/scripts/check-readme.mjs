#!/usr/bin/env node
/**
 * Release gate for the plugin marketplace readme files.
 *
 * The marketplace reads each release's `README.md` fallback asset and its
 * `README.<locale>.md` assets, and the app resolves any image referenced
 * inside them against the release's download URL. Because a GitHub release
 * is a flat list of assets, every referenced image must be:
 *
 *   1. Shipped inside the `readme/` folder (the only folder the release
 *      workflow uploads), and
 *   2. Referenced by its bare filename (`![alt](shot.png)`), never a
 *      nested path (`img/shot.png`) — a nested path resolves to a URL the
 *      release does not actually serve, so the image is silently broken.
 *
 * This gate fails a build/release when the `readme/` folder is absent, is
 * not flat, ships no `README.md` / `README.<locale>.md`, or references an
 * image by a nested/missing path. External `http(s)://` and `data:` image
 * URIs are allowed (they are not release assets).
 *
 * Usage:
 *   node scripts/check-readme.mjs            # checks ./readme
 *   node scripts/check-readme.mjs <dir>      # checks <dir>/readme
 *
 * Dependency-free on purpose — it ships inside every scaffolded plugin.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(process.argv[2] ?? process.cwd())
const README_DIR = join(ROOT, "readme")

const RULE_SUMMARY =
	"readme/ must be flat; each README image is referenced by a " +
	"bare filename that exists in readme/ (absolute http(s)/data URIs are ok)"

// `![alt](src)`, `![alt](src "title")`, `<img src="x">` (`src` images only).
const MARKDOWN_IMG_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
const HTML_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi
const EXT_URL_RE = /^(?:https?:\/\/|data:)/i
/** `README.md` or `README.<locale>.md` — the marketplace readme assets. */
const README_FILE_RE = /^(?:README\.md|README\.[A-Za-z0-9-]+\.md)$/

function isRelative(src) {
	return !EXT_URL_RE.test(src)
}

/**
 * A relative reference is valid only as a flat bare filename that exists
 * inside `readme/` — not a nested path and not a missing/unshipsed file.
 */
function resolveRelativeRef(src, file, issues) {
	const trimmed = src.trim().replace(/^\.\//, "")
	if (trimmed.length === 0) {
		issues.push(`${file}: empty image reference`)
		return
	}
	if (
		trimmed.includes("/") ||
		trimmed.includes("\\") ||
		trimmed.includes("..")
	) {
		issues.push(
			`${file}: image "${src}" is not flat — use a bare filename like "shot.png" (release assets are flat)`,
		)
		return
	}
	const target = join(README_DIR, trimmed)
	if (!existsSync(target) || !statSync(target).isFile()) {
		issues.push(
			`${file}: image "${src}" is not in readme/ — every referenced image must be committed there (it is published with the release)`,
		)
	}
}

function collectImageRefs(text) {
	const refs = []
	for (const match of text.matchAll(MARKDOWN_IMG_RE)) refs.push(match[1])
	for (const match of text.matchAll(HTML_IMG_RE)) refs.push(match[2])
	return refs
}

function main() {
	if (!existsSync(README_DIR)) {
		console.log(
			"[check-readme] no readme/ folder — nothing to gate (a release without a readme is valid).",
		)
		return
	}

	const entries = readdirSync(README_DIR, { withFileTypes: true })
	const issues = []

	// 1. Flat-only: any subdirectory makes the folder publish incorrectly.
	for (const entry of entries) {
		if (entry.isDirectory()) {
			issues.push(
				`readme/${entry.name}/ is a subdirectory — the readme folder must be flat (release assets are a flat list)`,
			)
		}
	}

	const mdFiles = entries
		.filter((entry) => entry.isFile() && README_FILE_RE.test(entry.name))
		.map((entry) => entry.name)

	if (mdFiles.length === 0) {
		issues.push(
			"readme/ has no README.md / README.<locale>.md — the release would ship images but the marketplace could not display a readme",
		)
	}

	// 2. Flat, present image references inside each readme markdown.
	for (const name of mdFiles) {
		const text = readFileSync(join(README_DIR, name), "utf-8")
		for (const src of collectImageRefs(text)) {
			if (isRelative(src)) resolveRelativeRef(src, `readme/${name}`, issues)
		}
	}

	if (issues.length > 0) {
		console.error("[check-readme] gate failed:")
		for (const issue of issues) console.error(`  - ${issue}`)
		console.error(`\n${RULE_SUMMARY}`)
		process.exit(1)
	}

	console.log(
		`[check-readme] readme/ ok — ${mdFiles.length} readme file(s), flat references only.`,
	)
}

main()
