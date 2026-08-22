import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"image-variant": "src/image-variant.ts",
		"media-exts": "src/media-exts.ts",
		plugin: "src/plugin.ts",
		resource: "src/resource.ts",
		result: "src/result.ts",
		schema: "src/schema.ts",
		template: "src/template.ts",
		"text-limits": "src/text-limits.ts",
	},
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "esnext",
	platform: "neutral",
	splitting: false,
	treeshake: true,
})
