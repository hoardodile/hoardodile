import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"contract/index": "src/contract/index.ts",
		"probe/index": "src/probe/index.ts",
		"render/index": "src/render/index.ts",
		"hoard/index": "src/hoard/index.ts",
		"media/index": "src/media/index.ts",
	},
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "node20",
	platform: "node",
	// The worker entry resolves through the package's own exports map, so
	// bundling shape does not matter — keep every entry self-contained.
	splitting: false,
	treeshake: true,
	// /contract's test suite runs on the consumer's own vitest; never
	// bundle a copy into the published tarball.
	external: ["vitest"],
})
