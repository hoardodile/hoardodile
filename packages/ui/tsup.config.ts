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
	// Multiple entries import each other (e.g. `image-crop-panel` imports
	// `app-dialog` for `DialogFooterActions`). Without splitting, tsup inlines
	// that shared module into every entry, so the `@hoardodile/ui` dist ends up
	// with TWO copies of the `DialogFooterActionsContext` React context. A
	// production bundle then gives `<AppDialog>`'s provider and
	// `<ImageCropPanel>`'s consumer different context instances, so the crop
	// action stops landing in the dialog footer (it falls back to inline,
	// split from the footer's Cancel by the hairline). Keep splitting on so
	// shared modules (and React singletons) exist exactly once.
	splitting: true,
	treeshake: true,
	// CSS ships as-is (Tailwind processes it in each consumer's build);
	// leave the @imports of the Tailwind toolchain unresolved.
	external: ["tailwindcss", "tw-animate-css"],
	esbuildOptions(options) {
		options.loader = { ...options.loader, ".css": "copy" }
	},
})
