import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const root = dirname(fileURLToPath(import.meta.url))

/**
 * Vite tags module scripts/styles with `crossorigin`. `loadFile` / `file://`
 * has no CORS headers, so Chromium drops those assets and the wizard is blank.
 */
function stripCrossorigin(): Plugin {
	return {
		name: "strip-crossorigin",
		enforce: "post",
		transformIndexHtml(html) {
			return html.replace(/(\s)crossorigin(\s|>)/gi, "$2")
		},
	}
}

export default defineConfig(({ command }) => ({
	root: resolve(root, "src/wizard"),
	base: command === "serve" ? "/" : "./",
	plugins: [react(), tailwindcss(), stripCrossorigin()],
	server: {
		host: "127.0.0.1",
		port: 5174,
		strictPort: true,
		origin: "http://127.0.0.1:5174",
	},
	build: {
		outDir: resolve(root, "out/wizard"),
		emptyOutDir: true,
		sourcemap: true,
		modulePreload: {
			polyfill: false,
		},
	},
}))
