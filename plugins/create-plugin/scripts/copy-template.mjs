// Copies the embedded template into dist so the published tarball
// (files: ["dist"]) carries everything the scaffolder needs at runtime.
import { cpSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const src = join(ROOT, "src", "template")
const dst = join(ROOT, "dist", "template")

rmSync(dst, { recursive: true, force: true })
cpSync(src, dst, {
	recursive: true,
	filter: (p) => !/node_modules|dist|\.turbo/.test(p),
})
console.log("[create-plugin] template copied to dist/template/")
