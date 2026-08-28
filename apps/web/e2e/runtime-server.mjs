/**
 * Static server for the plugin-consent e2e fixtures: serves
 * `apps/web/e2e/fixtures/runtime/` so a fixture plugin's `onInstall`
 * download can hit a deterministic `http://127.0.0.1:<port>/…` URL.
 * Started as a third webServer by playwright.config.ts (local mode).
 *
 * `E2E_RUNTIME_DIR` overrides the fixture directory; `PORT` overrides
 * `E2E_RUNTIME_PORT ?? 3200` (3200 sits outside the Windows excluded
 * port ranges — 3111 is inside the 3047–3146 block).
 */
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import http from "node:http"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(
	process.env.E2E_RUNTIME_DIR ?? join(__dirname, "fixtures", "runtime"),
)
const port = Number(process.env.PORT ?? process.env.E2E_RUNTIME_PORT ?? 3200)

// The downloader sends `Accept-Encoding: identity` and follows redirects
// manually; a plain GET with the right content type is all it needs.
const server = http.createServer(async (req, res) => {
	const name = (req.url ?? "/").split("?", 1)[0] ?? "/"
	const path = join(root, name)
	if (extname(path) !== ".js" || !path.startsWith(root)) {
		res.writeHead(404, { "content-type": "application/json" })
		res.end(JSON.stringify({ error: "not found" }))
		return
	}
	const info = await stat(path).catch(() => undefined)
	if (info === undefined || !info.isFile()) {
		res.writeHead(404, { "content-type": "application/json" })
		res.end(JSON.stringify({ error: "not found" }))
		return
	}
	res.writeHead(200, { "content-type": "text/javascript" })
	createReadStream(path).pipe(res)
})

server.listen(port, "127.0.0.1", () => {
	console.log(
		`[e2e-runtime-server] serving ${root} on http://127.0.0.1:${port}`,
	)
})
