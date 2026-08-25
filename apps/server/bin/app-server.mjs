#!/usr/bin/env node
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const entry = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"dist",
	"main.js",
)

if (!existsSync(entry)) {
	console.error(
		"app-server: dist/main.js not found. Run `pnpm build` first to build the server.",
	)
	process.exit(1)
}

await import(pathToFileURL(entry).href)
