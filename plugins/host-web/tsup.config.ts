import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		node: "src/mock-node/index.ts",
	},
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "esnext",
	platform: "browser",
	splitting: false,
	treeshake: true,
})
