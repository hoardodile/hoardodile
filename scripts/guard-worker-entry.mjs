#!/usr/bin/env node
/**
 * Guard: the plugin sandbox worker entry (`plugins/host/src/sandbox/
 * worker-entry.mjs`) is plain dependency-free JS and mirrors the
 * HOOK_NAMES / API_METHOD_NAMES / LOG_METHOD_NAMES lists declared in
 * the contract (`plugins/sdk-types/src/plugin-definition.ts`) and the
 * sandbox protocol (`plugins/host/src/sandbox/protocol.ts`). A drift
 * only surfaces at runtime as "unknown API method" RPC failures — this
 * script makes the drift a lint error instead of a vitest-only
 * backstop.
 *
 * Usage:
 *   node scripts/guard-worker-entry.mjs                      # full check
 *   node scripts/guard-worker-entry.mjs <entry> <protocol>   # explicit files
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const HOST_SRC = fileURLToPath(new URL("../plugins/host/src", import.meta.url))
const entryPath = process.argv[2] ?? `${HOST_SRC}/sandbox/worker-entry.mjs`
const protocolPath = process.argv[3] ?? `${HOST_SRC}/sandbox/protocol.ts`

/** Extract the double-quoted items of the first `[...]` list after `name`. */
function extractStringList(source, name, file) {
	const start = source.indexOf(`const ${name}`)
	if (start === -1) throw new Error(`${name} not found in ${file}`)
	const open = source.indexOf("[", start)
	const close = source.indexOf("]", open)
	if (open === -1 || close === -1) {
		throw new Error(`${name} list not found in ${file}`)
	}
	const out = []
	for (const m of source.slice(open, close).matchAll(/"([^"]+)"/g)) {
		if (m[1] !== undefined) out.push(m[1])
	}
	return out
}

/** Read a `export const NAME = [...]` (or `= new Set([...])`) list from a TS module. */
function extractExportedArray(source, name, file) {
	const setRe = new RegExp(
		`export const ${name}[^=]*= new Set\\(\\[([^\\]]*)\\]\\)`,
		"s",
	)
	const arrRe = new RegExp(`export const ${name}[^=]*= \\[([^\\]]*)\\]`, "s")
	const match = source.match(setRe) ?? source.match(arrRe)
	if (match === null) {
		throw new Error(`export const ${name} not found in ${file}`)
	}
	const out = []
	for (const m of match[1].matchAll(/"([^"]+)"/g)) {
		if (m[1] !== undefined) out.push(m[1])
	}
	return out
}

const entrySource = readFileSync(entryPath, "utf-8")
const contractSource = readFileSync(
	fileURLToPath(
		new URL("../plugins/sdk-types/src/plugin-definition.ts", import.meta.url),
	),
	"utf-8",
)
const protocolSource = readFileSync(protocolPath, "utf-8")

/** name → { source, mode }. `exact` = order matters; `sorted` = set. */
const CHECKS = [
	["HOOK_NAMES", contractSource, "exact"],
	["API_METHOD_NAMES", protocolSource, "exact"],
	["LOG_METHOD_NAMES", protocolSource, "sorted"],
]

let failures = 0
for (const [name, source, mode] of CHECKS) {
	const inEntry = extractStringList(entrySource, name, entryPath)
	const inSource = extractExportedArray(
		source,
		name,
		`${source === protocolSource ? protocolPath : "plugin-definition.ts"}`,
	)
	const entryKey = [...inEntry].sort()
	const sourceKey = [...inSource].sort()
	const equal =
		mode === "sorted"
			? JSON.stringify(entryKey) === JSON.stringify(sourceKey)
			: JSON.stringify(inEntry) === JSON.stringify(inSource)
	if (equal) continue
	failures += 1
	console.error(
		`[guard-worker-entry] ${name} drifted:\n` +
			`  worker-entry: ${JSON.stringify(inEntry)}\n` +
			`  source:       ${JSON.stringify(inSource)}`,
	)
}

if (failures > 0) {
	console.error(
		`\n${failures} sandbox constant list(s) drifted — keep worker-entry.mjs in sync with the contract.`,
	)
	process.exit(1)
}
console.log(
	"guard-worker-entry passed: the sandbox constant lists are in sync.",
)
