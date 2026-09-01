#!/usr/bin/env node
/**
 * Copy the canonical template (`plugins/template`) into `dist` so the
 * published tarball (`files: ["dist"]`) carries everything the scaffolder
 * needs at runtime. The embedded copy is generated at build time — there is
 * exactly one committed source of truth, `plugins/template`, and no manual
 * sync step.
 */
import { cpSync, existsSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const src = resolve(ROOT, "..", "template")
const dst = join(ROOT, "dist", "template")

if (!existsSync(src)) {
	console.error(`[create-plugin] template not found at ${src}`)
	process.exit(1)
}

rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, {
	recursive: true,
	filter: (p) => !/node_modules|dist|\.turbo|\.playwright/.test(p),
})
console.log("[create-plugin] template copied to dist/template/")
