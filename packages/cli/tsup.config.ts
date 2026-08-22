import { defineConfig } from "tsup"

export default defineConfig({
	entry: {
		main: "src/main.ts",
	},
	format: ["esm"],
	dts: true,
	sourcemap: true,
	clean: true,
	// The package requires Node 24; targeting it keeps `node:sqlite`
	// (a Node 22+ builtin) recognised, so the specifier survives the
	// bundle instead of being rewritten to a bare `sqlite`.
	target: "node24",
	platform: "node",
	splitting: false,
	treeshake: true,
	// Keep the build stack out of the bundle: vite and its plugin chain
	// are real runtime dependencies installed next to this package.
	// `node:sqlite` is listed because the bundler's builtin table
	// predates it and would otherwise rewrite it to a bare `sqlite`.
	// `@hoardodile/host/render` stays external so its `sharp` import is
	// only resolved when a render is actually requested.
	external: [
		"@hoardodile/host/render",
		"@rolldown/plugin-babel",
		"@tailwindcss/vite",
		"@vitejs/plugin-react",
		"babel-plugin-react-compiler",
		"node:sqlite",
		"vite",
		"vitest",
	],
})
