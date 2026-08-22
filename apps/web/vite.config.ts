import { readFileSync } from "node:fs"
import path from "node:path"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { visualizer } from "rollup-plugin-visualizer"
import inspect from "vite-plugin-inspect"
import { VitePWA } from "vite-plugin-pwa"
import { defineConfig } from "vitest/config"
import { cspMetaPlugin } from "../../scripts/lib/csp-meta.ts"

const serverTarget = process.env.VITE_SERVER_URL ?? "http://127.0.0.1:3000"

// Dev tooling defaults (web SPA, desktop wizard) are owned here
// so changing a port in one place never desyncs the rest.
const devPorts: { spa: number } = JSON.parse(
	readFileSync(
		new URL("../../scripts/lib/dev-ports.json", import.meta.url),
		"utf8",
	),
)

// The unified app version lives in the root package.json; bake it into the
// bundle as __APP_VERSION__ (see src/lib/appInfo.ts).
const rootPackage: { version?: unknown } = JSON.parse(
	readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
)
const appVersion =
	typeof rootPackage.version === "string" ? rootPackage.version : "0.0.0"

// Paths forwarded to the Fastify server during dev. Covers the tRPC mount
// and the raw HTTP surface (auth, health, and future upload / range GET / SSE
// routes under /api). Cookies flow through because Vite proxies `credentials`
// transparently via `changeOrigin`.
const proxyPaths = ["/trpc", "/auth", "/health", "/api"] as const

// Unit tests only need JSX transform. Router codegen, the React Compiler,
// Tailwind, inspect, and the PWA plugin are wasted work per file.
const isTest = process.env.VITEST === "true"

export default defineConfig({
	plugins: [
		cspMetaPlugin(),
		!isTest &&
			tanstackRouter({
				target: "react",
				autoCodeSplitting: false,
				routesDirectory: "./src/routes",
				generatedRouteTree: "./src/routeTree.gen.ts",
				routeFileIgnorePattern: "\\.test\\.(ts|tsx)$",
			}),
		react(),
		!isTest && babel({ presets: [reactCompilerPreset()] }),
		!isTest && tailwindcss(),
		// Bundle report on demand only: in dev the plugin's middleware
		// otherwise hijacks the SPA's /stats route with the treemap page.
		// Emit into dist/ so the report never lands in the dev-served root.
		!isTest &&
			process.env.BUNDLE_VISUALIZE === "1" &&
			visualizer({ filename: "dist/bundle-stats.html" }),
		!isTest && inspect(),
		!isTest &&
			VitePWA({
				strategies: "injectManifest",
				srcDir: "src",
				filename: "sw.ts",
				injectManifest: {
					injectionPoint: "self.__WB_MANIFEST",
					// Largest entry is the lazily-loaded document editor chunk
					// (~1.4 MiB, fetched only when a document opens); keep the
					// cap comfortably above the largest precached asset.
					maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
				},
				devOptions: {
					enabled: true,
					// In dev the SW is served through Vite's module pipeline (ESM),
					// so it must be registered as a module worker; the production
					// build of the same source is a classic script via Workbox.
					type: "module",
				},
			}),
	],
	define: {
		__APP_VERSION__: JSON.stringify(appVersion),
	},
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	server: {
		port: devPorts.spa,
		strictPort: false,
		proxy: Object.fromEntries(
			proxyPaths.map((p) => [
				p,
				{
					target: serverTarget,
					changeOrigin: true,
					secure: false,
					ws: false,
				},
			]),
		),
	},
	build: {
		chunkSizeWarningLimit: Infinity,
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test/setup.ts"],
		css: false,
		include: ["src/**/*.test.{ts,tsx}"],
		exclude: ["e2e/**", "node_modules/**", "dist/**"],
		pool: "threads",
		// Default is cores-1 workers; turbo runs several packages' tests in
		// parallel, so cap each vitest run to keep the machine responsive.
		maxWorkers: 2,
	},
})
