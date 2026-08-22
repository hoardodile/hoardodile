import { builtinModules } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	ssr: {
		noExternal: true,
	},
	build: {
		ssr: true,
		outDir: resolve(root, "out/main"),
		emptyOutDir: true,
		target: "node22",
		lib: {
			entry: resolve(root, "src/main/index.ts"),
			formats: ["es"],
			fileName: () => "index.js",
		},
		rollupOptions: {
			external: [
				"electron",
				...builtinModules,
				...builtinModules.map((name) => `node:${name}`),
			],
		},
		sourcemap: true,
		minify: false,
	},
})
