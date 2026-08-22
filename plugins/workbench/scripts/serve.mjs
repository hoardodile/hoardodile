#!/usr/bin/env node
/**
 * Standalone server for the published workbench bundle: the prebuilt SPA
 * from `dist/` plus the read-only mounts the page needs at runtime. The
 * routing itself lives in `mounts.mjs`, shared with the vite dev server
 * so the two can never drift.
 *
 * Usage:
 *   node serve.mjs --plugin <plugin-dist-dir> --data <data-dir> [--port 5199]
 *                  [--snapshot <hooks.json>]
 *
 * Also exported so the plugin CLI's `dev` subcommand can serve the
 * workbench with richer providers (real storage, preview variants,
 * video frames): `import { serveWorkbench } from "@hoardodile/workbench"`.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {
	contentTypeOf,
	createDirectoryProviders,
	createWorkbenchMounts,
} from "./mounts.mjs"

const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)))

/**
 * Serve the published workbench on `port`. Pass `providers` for real
 * data (the CLI does), or `dataDir` for the plain-directory default.
 * Returns the http.Server.
 */
export function serveWorkbench(opts) {
	const { pluginDir, dataDir, port = 5199, host = "127.0.0.1" } = opts
	if (pluginDir === undefined) {
		console.warn("[workbench] no plugin dir — pass --plugin <dist-dir>")
	}
	const base =
		opts.providers ??
		(dataDir === undefined
			? { resources: () => [] }
			: createDirectoryProviders(dataDir))
	if (opts.providers === undefined && dataDir === undefined) {
		console.warn("[workbench] no data dir — pass --data <data-dir>")
	}
	// A snapshot provider passed on its own (the classic `--snapshot`
	// shape) still works: it is just one more provider.
	const providers =
		opts.snapshot === undefined ? base : { ...base, snapshot: opts.snapshot }

	const mounts = createWorkbenchMounts({ pluginDir, providers })

	const server = createServer((req, res) => {
		void (async () => {
			try {
				for (const mount of mounts) {
					if (await mount(req, res)) return
				}
				serveSpa(req, res)
			} catch (err) {
				console.error("[workbench] request failed:", err)
				if (!res.headersSent) res.statusCode = 500
				res.end("workbench error")
			}
		})()
	})

	return new Promise((resolveStart) => {
		server.listen(port, host, () => {
			console.log(`[workbench] serving on http://${host}:${port}`)
			resolveStart(server)
		})
	})
}

function serveSpa(req, res) {
	const url = new URL(req.url ?? "/", "http://workbench.local")
	if (url.pathname === "/") {
		res.setHeader("content-type", "text/html; charset=utf-8")
		res.end(readFileSync(join(DIST_DIR, "index.html")))
		return
	}
	const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "")
	const abs = resolve(DIST_DIR, rel)
	if (
		abs === DIST_DIR ||
		!abs.startsWith(DIST_DIR + sep) ||
		!existsSync(abs) ||
		statSync(abs).isDirectory()
	) {
		res.statusCode = 404
		res.end("not found")
		return
	}
	res.setHeader("content-type", contentTypeOf(abs))
	res.end(readFileSync(abs))
}

// CLI entry when run directly.
const isMain =
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
	const args = process.argv.slice(2)
	const flagValue = (name) => {
		const i = args.indexOf(name)
		return i !== -1 ? args[i + 1] : undefined
	}
	const snapshotPath = flagValue("--snapshot")
	// Re-read on every request: a `plugin dev` style watcher may rewrite
	// the file as the plugin rebuilds.
	const snapshot =
		snapshotPath === undefined
			? undefined
			: () => {
					try {
						return JSON.parse(readFileSync(resolve(snapshotPath), "utf8"))
					} catch {
						return undefined
					}
				}
	await serveWorkbench({
		pluginDir: flagValue("--plugin"),
		dataDir: flagValue("--data"),
		port: Number(flagValue("--port") ?? 5199),
		snapshot,
	})
}
