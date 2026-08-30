import { defineConfig } from "tsup"

// Each entry is a first-class import (`@hoardodile/i18n`, `.../core`,
// `.../catalogs`, `.../catalogs/ui`), so every supported subpath maps to
// its own dist chunk mirroring the source file. JSON catalogs are bundled
// into each chunk (no runtime asset loading, pure-JS consumption in the
// Electron main process).
export default defineConfig({
	entry: [
		"src/index.ts",
		"src/core.ts",
		"src/create-i18n.ts",
		"src/react.ts",
		"src/catalogs.ts",
		"src/catalogs/ui.ts",
		"src/catalogs/shell.ts",
		"src/catalogs/workbench.ts",
	],
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "esnext",
	platform: "neutral",
	splitting: false,
	treeshake: true,
})
