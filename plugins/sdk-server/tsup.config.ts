import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		helpers: "src/helpers.ts",
	},
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "node20",
	platform: "node",
	splitting: false,
	treeshake: true,
})
