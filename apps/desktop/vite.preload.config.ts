import { builtinModules } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	build: {
		outDir: resolve(root, "out/preload"),
		emptyOutDir: true,
		target: "node22",
		lib: {
			entry: resolve(root, "src/preload/index.ts"),
			formats: ["cjs"],
			fileName: () => "index.cjs",
		},
		rollupOptions: {
			external: [
				"electron",
				...builtinModules,
				...builtinModules.map((name) => `node:${name}`),
			],
			output: {
				inlineDynamicImports: true,
			},
		},
		sourcemap: true,
		minify: false,
	},
})
