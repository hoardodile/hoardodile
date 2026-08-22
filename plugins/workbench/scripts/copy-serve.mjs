// Copies the standalone serve entry into the published dist so the
// package ships exactly one artifact directory (`files: ["dist"]`).
import { copyFileSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dst = join(ROOT, "dist", "serve.mjs")
mkdirSync(dirname(dst), { recursive: true })
copyFileSync(join(ROOT, "scripts", "serve.mjs"), dst)
copyFileSync(
	join(ROOT, "scripts", "mounts.mjs"),
	join(ROOT, "dist", "mounts.mjs"),
)
copyFileSync(
	join(ROOT, "scripts", "serve.d.mts"),
	join(ROOT, "dist", "serve.d.mts"),
)
console.log("[workbench] serve.mjs + mounts.mjs + serve.d.mts copied to dist/")
