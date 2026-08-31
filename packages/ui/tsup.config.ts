import { defineConfig } from "tsup"

// Component/helper subpaths are first-class imports (`@hoardodile/ui/components/button`,
// `.../components/app-dialog`, `.../icons/registry`, `.../lib/utils`,
// `.../hooks/use-mobile`), so every source file under those dirs is its own
// entry. tsup preserves the directory structure below `src/`, keeping the
// dist exports map a mirror of the sources.
export default defineConfig({
	entry: [
		"src/index.ts",
		"src/viewport.ts",
		"src/styles/theme.css",
		"src/lib/*.ts",
		"!src/lib/*.test.ts",
		"src/hooks/*.ts",
		"src/icons/*.{ts,tsx}",
		"!src/icons/*.test.{ts,tsx}",
		"src/components/*.tsx",
		"!src/components/*.test.tsx",
		"src/res-card-template/*.{ts,tsx}",
		"!src/res-card-template/*.test.{ts,tsx}",
	],
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "esnext",
	platform: "browser",
	splitting: false,
	treeshake: true,
	// CSS ships as-is (Tailwind processes it in each consumer's build);
	// leave the @imports of the Tailwind toolchain unresolved.
	external: ["tailwindcss", "tw-animate-css"],
	esbuildOptions(options) {
		options.loader = { ...options.loader, ".css": "copy" }
	},
})
