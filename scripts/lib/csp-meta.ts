import { createHash } from "node:crypto"
import type { Plugin } from "vite"

/**
 * Content Security Policy for the app shell documents (SPA + desktop
 * wizard), delivered as a meta tag injected by Vite's `transformIndexHtml`.
 *
 * Why a meta tag: Electron's dev-mode security warning ("Insecure
 * Content-Security-Policy") keys off the document's
 * `meta[http-equiv="Content-Security-Policy"]`; the Fastify sidecar's
 * `frame-ancestors 'self'` header only guards framing and does not satisfy
 * the check. The same document also serves the plain web build, so the meta
 * hardens both.
 *
 * Two policies:
 *  - serve: dev only. React Fast Refresh injects the @vitejs/plugin-react
 *    preamble as an inline module script, so `'unsafe-inline'` is required;
 *    `ws:`/`wss:` cover the HMR websocket on any dev host/port (the dev
 *    server is started with `strictPort: false`, so the port can drift
 *    from the default). Never `'unsafe-eval'` — Vite dev does not need it.
 *  - build: strict. Every inline script is allowed by sha256 hash computed
 *    here from the exact script text, so the policy can never drift from
 *    `index.html`. Fails loud when no inline script remains — a policy
 *    without hashes would silently stop covering first-paint code.
 *
 * The only authorized external request is the user-triggered update check
 * (`apps/web/src/features/settings/checkUpdates.ts`), so `https://api.github.com`
 * is whitelisted in `connect-src`; nothing else leaves the origin.
 */

/** Raw text of every inline `<script>` (no `src`), in document order. */
export function extractInlineScripts(html: string): string[] {
	const scripts: string[] = []
	for (const match of html.matchAll(
		/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
	)) {
		const attrs = match[1] ?? ""
		if (/\bsrc\s*=/i.test(attrs)) continue
		scripts.push(match[2] ?? "")
	}
	return scripts
}

/** SHA-256 (base64) of a script's raw text — the exact CSP source hash. */
export function sha256Base64(text: string): string {
	return createHash("sha256").update(text).digest("base64")
}

/** Shared directives; only script/connect sources differ per mode. */
const commonDirectives = [
	"style-src 'self' 'unsafe-inline'",
	/* ThemeProvider injects a <style> at runtime (disableTransitionsTemporarily);
	 * React/BlockNote set styles via CSSOM, which is not CSP-governed. */
	"img-src 'self' data: blob:",
	/* blob: — client-generated upload thumbnails (useFileThumb); data: —
	 * pasted images in documents. */
	"media-src 'self' blob:",
	"font-src 'self' data:",
	"frame-src 'self'",
	/* Plugin iframes always load /api/plugins/<id>/ — same origin, also in
	 * dev where Vite proxies /api to the sidecar. */
	"worker-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
] as const

/** Policy for Vite dev servers (app window + wizard). */
export function servePolicy(): string {
	return [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		/* React Fast Refresh preamble is an inline module script. */
		"connect-src 'self' ws: wss: https://api.github.com",
		...commonDirectives,
	].join("; ")
}

/**
 * Strict policy for built documents. Every inline script must be hashed
 * explicitly; nothing is allowed `'unsafe-inline'` or `'unsafe-eval'`.
 */
export function buildPolicy(inlineScripts: readonly string[]): string {
	if (inlineScripts.length === 0) {
		throw new Error(
			"csp-meta: no inline scripts in the built document; the strict " +
				"script-src policy would be vacuous — update the page or the " +
				"policy.",
		)
	}
	const hashes = inlineScripts.map((text) => `'sha256-${sha256Base64(text)}'`)
	return [
		"default-src 'self'",
		`script-src 'self' ${hashes.join(" ")}`,
		"connect-src 'self' https://api.github.com",
		...commonDirectives,
	].join("; ")
}

export type CspMetaOptions = {
	/**
	 * Inject the strict policy into built HTML. Defaults to true; set false
	 * for documents that are also loaded via `file://` (`loadFile`), where
	 * `'self'` matching against sibling assets is not guaranteed — a
	 * packaged app does not show Electron's dev security warnings anyway.
	 */
	readonly buildMeta?: boolean
}

/**
 * Injects the CSP meta as the first element of `<head>` — `order: "post"`
 * matters: React Fast Refresh's preamble also injects at `head-prepend`,
 * and the last hook wins that position. With the meta first, the inline
 * theme script, the dev preamble, and all module scripts are governed.
 */
export function cspMetaPlugin(options: CspMetaOptions = {}): Plugin {
	let command: "serve" | "build" = "serve"
	return {
		name: "csp-meta",
		configResolved(config) {
			command = config.command
		},
		transformIndexHtml: {
			order: "post",
			handler(html) {
				if (command === "serve") {
					return [
						{
							tag: "meta",
							injectTo: "head-prepend",
							attrs: {
								"http-equiv": "Content-Security-Policy",
								content: servePolicy(),
							},
						},
					]
				}
				if (options.buildMeta === false) return []
				return [
					{
						tag: "meta",
						injectTo: "head-prepend",
						attrs: {
							"http-equiv": "Content-Security-Policy",
							content: buildPolicy(extractInlineScripts(html)),
						},
					},
				]
			},
		},
	}
}
