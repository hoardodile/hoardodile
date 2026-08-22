import { createReadStream, readFileSync } from "node:fs"
import { stat } from "node:fs/promises"
import { join, normalize } from "node:path"
import { MOBILE_INITIAL_SCALE } from "@hoardodile/ui/viewport"
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify"
import { assertInside } from "src/infra/storage/paths.ts"
import { extToContentType } from "./utils.ts"

/**
 * Serves any file from a plugin's directory. Supports nested paths.
 * Requests to `/api/plugins/:id` (no trailing path) serve `index.html`.
 */
async function pluginFilesImpl(app: FastifyInstance): Promise<void> {
	app.get<{ Params: { id: string } }>(
		"/api/plugins/:id",
		async (req, reply) => {
			const { id } = req.params
			return servePluginFile(app, id, "index.html", reply)
		},
	)

	app.get<{ Params: { id: string; "*": string } }>(
		"/api/plugins/:id/*",
		async (req, reply) => {
			const { id } = req.params
			const filePath = req.params["*"]
			if (filePath === undefined || filePath === "") {
				return servePluginFile(app, id, "index.html", reply)
			}
			return servePluginFile(app, id, filePath, reply)
		},
	)
}

async function servePluginFile(
	app: FastifyInstance,
	id: string,
	filePath: string,
	reply: FastifyReply,
): Promise<FastifyReply> {
	const entry = app.pluginLoader.getRegistry().getById(id)
	if (entry === undefined || !entry.enabled) {
		return reply.status(404).type("application/json").send({
			error: "plugin not found",
		})
	}

	if (entry.diskPath === undefined || entry.diskPath === null) {
		return reply.status(404).type("application/json").send({
			error: "plugin has no disk path",
		})
	}

	const sanitized = normalize(filePath).replace(/^(\.\.(\/|\\|$))+/g, "")
	const fullPath = join(entry.diskPath, sanitized)

	try {
		assertInside(entry.diskPath, fullPath)
	} catch {
		return reply.status(403).type("application/json").send({
			error: "forbidden",
		})
	}

	const fileInfo = await stat(fullPath).catch(() => undefined)
	if (fileInfo === undefined || !fileInfo.isFile()) {
		return reply.status(404).type("application/json").send({
			error: "file not found",
		})
	}

	const ext = filePath.split(".").pop()?.toLowerCase()
	const contentType = getContentType(ext)
	const isDevelopment = app.env.NODE_ENV === "development"
	const cacheControl =
		entry.dev === true || isDevelopment
			? "no-cache, no-store, must-revalidate"
			: "public, max-age=31536000, immutable"

	if (ext === "html") {
		const html = readFileSync(fullPath, "utf-8")
		const injected = wrapHtml(html)
		return (
			reply
				.type(contentType)
				.header("cache-control", cacheControl)
				.header("x-content-type-options", "nosniff")
				// The host embeds plugin pages in a sandboxed iframe (no
				// allow-same-origin). Mirroring the same sandbox via CSP keeps
				// the page in an opaque origin even when a user is lured into
				// opening it top-level, where the iframe attribute would no
				// longer apply; frame-ancestors restricts embedding to the app.
				.header(
					"content-security-policy",
					"sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'self'",
				)
				.send(injected)
		)
	}

	return reply
		.type(contentType)
		.header("cache-control", cacheControl)
		.header("x-content-type-options", "nosniff")
		.send(createReadStream(fullPath))
}

/**
 * Wraps plugin-provided body content in a full HTML shell.
 * The shell injects the postMessage listener that receives {@link PluginIframeContext}
 * from the host and dispatches a `context-ready` CustomEvent.
 */
function wrapHtml(body: string): string {
	return [
		"<!DOCTYPE html>",
		"<html>",
		"<head>",
		'<meta charset="utf-8">',
		`<meta name="viewport" content="width=device-width, initial-scale=${MOBILE_INITIAL_SCALE}, maximum-scale=1.0, user-scalable=0">`,
		'<style type="text/css">html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style>',
		"</head>",
		"<body>",
		`<script>(function(){window.__pluginContext=undefined;window.__pluginVisibility=undefined;window.addEventListener("message",function(e){if(e.source!==window.parent)return;if(e.data?.type==="push"){if(e.data?.key==="context"){window.__pluginContext=e.data.data;window.dispatchEvent(new CustomEvent("context-ready",{detail:e.data.data}))}else if(e.data?.key==="visibility"){window.__pluginVisibility=e.data.data;window.dispatchEvent(new CustomEvent("visibility-changed",{detail:e.data.data}))}}})})();</script>`,
		body,
		"</body>",
		"</html>",
	].join("")
}

function getContentType(ext: string | undefined): string {
	if (ext === undefined) return "application/octet-stream"
	const image = extToContentType(ext)
	if (image !== "application/octet-stream") return image
	switch (ext) {
		case "html":
			return "text/html"
		case "js":
		case "mjs":
		case "ts":
		case "tsx":
			return "text/javascript"
		case "css":
			return "text/css"
		case "json":
			return "application/json"
		case "svg":
			return "image/svg+xml"
		case "woff":
			return "font/woff"
		case "woff2":
			return "font/woff2"
		default:
			return "application/octet-stream"
	}
}

export const pluginRenderPlugin = pluginFilesImpl satisfies FastifyPluginAsync
