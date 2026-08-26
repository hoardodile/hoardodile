import { readFileSync } from "node:fs"
import type { Plugin } from "vite"

/**
 * Inline the app logo into the app-shell documents (SPA + desktop wizard)
 * as a base64 data URI. Both index.html first paints show the full logo —
 * the SPA splash and the wizard's raw-HTML splash (React mounts later) —
 * with no network or disk request, so no near-white blank frame can ever
 * appear before it.
 *
 * Mirrors `csp-meta.ts`: a shared Vite transform that keeps the shell
 * documents correct by construction and fails loud when the marker drifts.
 */

/** Marker the index.html documents put in the splash `img` src. */
export const SPLASH_LOGO_TOKEN = "%HOARDODILE_LOGO_DATA_URL%"

export function logoDataUrl(png: Uint8Array): string {
	return `data:image/png;base64,${Buffer.from(png).toString("base64")}`
}

/**
 * Replace every {@link SPLASH_LOGO_TOKEN} occurrence. Throws when the
 * document no longer renders a splash — a missing marker would silently
 * regress to a blank first frame.
 */
export function installSplashLogo(
	html: string,
	dataUrl: string,
	token: string = SPLASH_LOGO_TOKEN,
): string {
	if (!html.includes(token)) {
		throw new Error(
			"splash-logo: no token in the document; the shell pages must " +
				"render the splash img — add or restore the splash markup.",
		)
	}
	return html.split(token).join(dataUrl)
}

export type SplashLogoPluginOptions = {
	/** Path to the 512×512 logo PNG read at transform time. */
	readonly pngPath: string
}

/**
 * `transformIndexHtml` plugin for the SPA and wizard Vite configs. Reads
 * the PNG once per build and swaps the token for the data URI in dev and
 * build alike.
 */
export function inlineSplashLogoPlugin(
	options: SplashLogoPluginOptions,
): Plugin {
	let dataUrl: string | undefined
	return {
		name: "inline-splash-logo",
		transformIndexHtml: {
			order: "post",
			handler(html) {
				dataUrl ??= logoDataUrl(readFileSync(options.pngPath))
				return installSplashLogo(html, dataUrl)
			},
		},
	}
}
