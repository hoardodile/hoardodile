#!/usr/bin/env node
import { createHash } from "node:crypto"
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { init } from "license-checker-rseidelsohn"

// Resolve everything against the workspace root so the script can run from
// any cwd (it is chained into apps/web's build/watch scripts).
import { WORKSPACE_ROOT } from "./lib/workspace.mjs"

const isCheckOnly = process.argv.includes("--check")

const OUTPUTS = [
	resolve(WORKSPACE_ROOT, "apps/web/public/licenses.json"),
	resolve(WORKSPACE_ROOT, "apps/web/public/LICENSE"),
]

// Scanning the full dependency tree is slow, so generation results are cached
// against a hash of everything the scan depends on (the lockfile fully
// determines the dependency tree). The cache lives in node_modules/.cache,
// which is gitignored. Any cache read/write failure falls back to a full scan.
const CACHE_FILE = resolve(
	WORKSPACE_ROOT,
	"node_modules/.cache/hoardodile-licenses.json",
)

function computeInputHash() {
	const hash = createHash("sha256")
	hash.update(readFileSync(resolve(WORKSPACE_ROOT, "pnpm-lock.yaml")))
	hash.update(readFileSync(resolve(WORKSPACE_ROOT, "LICENSE")))
	hash.update(readFileSync(fileURLToPath(import.meta.url)))
	return hash.digest("hex")
}

function readCachedHash() {
	try {
		const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"))
		return typeof cache.hash === "string" ? cache.hash : undefined
	} catch {
		return undefined
	}
}

function writeCachedHash(hash) {
	try {
		mkdirSync(dirname(CACHE_FILE), { recursive: true })
		writeFileSync(CACHE_FILE, `${JSON.stringify({ hash }, null, "\t")}\n`)
	} catch {
		// cache write failure is harmless; the next run just scans again
	}
}

function isCacheValid(hash) {
	return readCachedHash() === hash && OUTPUTS.every((p) => existsSync(p))
}

const SCAN_PATHS = ["apps/web", "apps/server"].map((p) =>
	resolve(WORKSPACE_ROOT, p),
)

const ALLOWED_LICENSE_TOKENS = new Set([
	"MIT",
	"ISC",
	"Apache-2.0",
	"BlueOak-1.0.0",
	"BSD-3-Clause",
	"BSD-2-Clause",
	"MIT-0",
	"CC0-1.0",
	"Python-2.0",
	"CC-BY-4.0",
	"CC-BY-3.0",
	"MPL-2.0",
	// LGPL-2.1 and GPL-3.0-or-later are fine here: the app is GPL-3.0 and
	// ffmpeg/ffprobe/7-Zip ship as standalone binaries invoked as child
	// processes (ffmpeg-static / @derhuerst/ffprobe-static /
	// @hoardodile/7z-bin — GPL-3.0 wrapper around the 7-Zip binary, itself
	// LGPL-2.1 + unRAR exception).
	"LGPL-2.1",
	"0BSD",
	"OFL-1.1",
	"GPL-3.0",
	"GPL-3.0*",
	"GPL-3.0-only",
	"GPL-3.0-or-later",
	"WTFPL",
	"Public Domain",
	"Unlicense",
])

/** Bundled webfonts listed on the About licenses page. Empty until install. */
const FONTS = []

function normalizeLicense(value) {
	if (Array.isArray(value)) return value.flatMap(normalizeLicense)
	if (typeof value !== "string") return []
	return value
		.replace(/[()]/g, " ")
		.split(/\s+(?:OR|AND)\s+/gu)
		.map((token) => token.trim())
		.filter(Boolean)
}

function isLicenseAllowed(raw) {
	const rawString = Array.isArray(raw) ? raw.join(" OR ") : String(raw ?? "")
	const tokens = normalizeLicense(raw)
	if (tokens.length === 0) return false
	const isOrExpression = /\s+OR\s+/iu.test(rawString)
	if (isOrExpression) {
		return tokens.some((token) => ALLOWED_LICENSE_TOKENS.has(token))
	}
	return tokens.every((token) => ALLOWED_LICENSE_TOKENS.has(token))
}

// Some very old packages declare a bare "BSD" while carrying the 2-clause
// text (parse-cache-control, pulled in by ffmpeg-static's http-basic).
// "Custom: License.txt" was used by 7z-wasm's GNU LGPL + unRAR
// restriction license (the same license as the 7-Zip binary it compiled);
// kept as an alias in case a similar license-text-only package returns.
const LEGACY_LICENSE_ALIASES = {
	BSD: "BSD-2-Clause",
	"Custom: License.txt": "LGPL-2.1",
}

function collectLicenseText(value) {
	if (Array.isArray(value)) return value.join(" / ")
	return String(value ?? "")
}

function checkLicenses(packages) {
	const invalid = []
	for (const pkg of packages) {
		if (!isLicenseAllowed(pkg.license)) {
			invalid.push(`${pkg.name}@${pkg.version}: ${pkg.license}`)
		}
	}
	return invalid
}

function runChecker(start) {
	return new Promise((resolve, reject) => {
		init(
			{
				start,
				production: true,
				excludePrivatePackages: true,
				customFormat: {
					name: "",
					version: "",
					licenses: "",
					repository: "",
					publisher: "",
					copyright: "",
				},
			},
			(err, data) => {
				if (err) reject(err)
				else resolve(data)
			},
		)
	})
}

async function main() {
	// --check always runs a full scan; generation reuses cached outputs when
	// the inputs (lockfile, LICENSE, this script) have not changed.
	const inputHash = isCheckOnly ? undefined : computeInputHash()
	if (inputHash !== undefined && isCacheValid(inputHash)) {
		console.log("Licenses unchanged, skipping scan.")
		return
	}

	const merged = new Map()
	for (const start of SCAN_PATHS) {
		const data = await runChecker(start)
		for (const [key, info] of Object.entries(data)) {
			if (merged.has(key)) continue
			const name = info.name ?? key.split("@").slice(0, -1).join("@")
			// First-party packages are not third-party notices: their license
			// lives in the repo and in LICENSE. Excluding them also makes the
			// file independent of workspace versions, so a release bump never
			// rewrites it (the file only changes with the lockfile).
			if (name.startsWith("@hoardodile/")) continue
			merged.set(key, {
				name,
				version: info.version ?? key.split("@").pop(),
				license:
					LEGACY_LICENSE_ALIASES[collectLicenseText(info.licenses)] ??
					collectLicenseText(info.licenses),
				repository: info.repository ?? "",
				publisher: info.publisher ?? "",
				copyright: info.copyright ?? "",
			})
		}
	}

	const packages = Array.from(merged.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	)

	const invalid = checkLicenses(packages)
	if (invalid.length > 0) {
		console.error("Found incompatible or unknown licenses:")
		for (const line of invalid) console.error(`  - ${line}`)
		process.exit(1)
	}

	if (isCheckOnly) {
		console.log(`License check passed (${packages.length} packages).`)
		return
	}

	const grouped = new Map()
	for (const pkg of packages) {
		const group = grouped.get(pkg.license) ?? []
		group.push(pkg)
		grouped.set(pkg.license, group)
	}
	const sortedLicenses = Array.from(grouped.entries())
		.map(([license, packagesForLicense]) => ({
			license,
			packages: packagesForLicense,
		}))
		.sort((a, b) => a.license.localeCompare(b.license))

	const licensesJson = {
		project: {
			name: "hoardodile",
			license: "GPL-3.0-only",
		},
		licenses: sortedLicenses,
		fonts: FONTS,
	}
	writeFileSync(OUTPUTS[0], `${JSON.stringify(licensesJson, null, "\t")}\n`)
	copyFileSync(resolve(WORKSPACE_ROOT, "LICENSE"), OUTPUTS[1])
	writeCachedHash(inputHash)

	console.log(
		`Generated apps/web/public/licenses.json and copied LICENSE (${packages.length} packages).`,
	)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
