#!/usr/bin/env node
/**
 * Release gate for the plugin marketplace introduction images.
 *
 * The marketplace reads each release's `intro.<locale>.md` asset and the
 * app resolves any image referenced inside it against the release's
 * download URL. Because a GitHub release is a flat list of assets, every
 * referenced image must be:
 *
 *   1. Shipped inside the `intro/` folder (the only folder the release
 *      workflow uploads), and
 *   2. Referenced by its bare filename (`![alt](shot.png)`), never a
 *      nested path (`img/shot.png`) — a nested path resolves to a URL the
 *      release does not actually serve, so the image is silently broken.
 *
 * This gate fails a build/release when the `intro/` folder is absent, is
 * not flat, ships no `intro.<locale>.md`, or references an image by a
 * nested/missing path. External `http(s)://` and `data:` image URIs are
 * allowed (they are not release assets).
 *
 * Usage:
 *   node scripts/check-intro.mjs            # checks ./intro
 *   node scripts/check-intro.mjs <dir>      # checks <dir>/intro
 *
 * Dependency-free on purpose — it ships inside every scaffolded plugin.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(process.argv[2] ?? process.cwd())
const INTRO_DIR = join(ROOT, "intro")

const RULE_SUMMARY =
	"intro/ must be flat; each intro.<locale>.md image is referenced by a " +
	"bare filename that exists in intro/ (absolute http(s)/data URIs are ok)"

// `![alt](src)`, `![alt](src "title")`, `<img src="x">` (`src` images only).
const MARKDOWN_IMG_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
const HTML_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi
const EXT_URL_RE = /^(?:https?:\/\/|data:)/i

function isRelative(src) {
	return !EXT_URL_RE.test(src)
}

/**
 * A relative reference is valid only as a flat bare filename that exists
 * inside `intro/` — not a nested path and not a missing/unshipsed file.
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
	const target = join(INTRO_DIR, trimmed)
	if (!existsSync(target) || !statSync(target).isFile()) {
		issues.push(
			`${file}: image "${src}" is not in intro/ — every referenced image must be committed there (it is published with the release)`,
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
	if (!existsSync(INTRO_DIR)) {
		console.log(
			"[check-intro] no intro/ folder — nothing to gate (a release without an introduction is valid).",
		)
		return
	}

	const entries = readdirSync(INTRO_DIR, { withFileTypes: true })
	const issues = []

	// 1. Flat-only: any subdirectory makes the folder publish incorrectly.
	for (const entry of entries) {
		if (entry.isDirectory()) {
			issues.push(
				`intro/${entry.name}/ is a subdirectory — the intro folder must be flat (release assets are a flat list)`,
			)
		}
	}

	const mdFiles = entries
		.filter(
			(entry) =>
				entry.isFile() && /^intro\.[A-Za-z0-9-]+\.md$/.test(entry.name),
		)
		.map((entry) => entry.name)

	if (mdFiles.length === 0) {
		issues.push(
			"intro/ has no intro.<locale>.md — the release would ship images but the marketplace could not display an introduction",
		)
	}

	// 2. Flat, present image references inside each intro markdown.
	for (const name of mdFiles) {
		const text = readFileSync(join(INTRO_DIR, name), "utf-8")
		for (const src of collectImageRefs(text)) {
			if (isRelative(src)) resolveRelativeRef(src, `intro/${name}`, issues)
		}
	}

	if (issues.length > 0) {
		console.error("[check-intro] gate failed:")
		for (const issue of issues) console.error(`  - ${issue}`)
		console.error(`\n${RULE_SUMMARY}`)
		process.exit(1)
	}

	console.log(
		`[check-intro] intro/ ok — ${mdFiles.length} introduction file(s), flat references only.`,
	)
}

main()
