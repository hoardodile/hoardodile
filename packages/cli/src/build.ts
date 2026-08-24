import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	watch,
} from "node:fs"
import { join } from "node:path"
import type { PluginManifest } from "@hoardodile/sdk-types"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { build } from "vite"
import { lintManifestTemplates } from "./template-lint.ts"

type BuildResult = Awaited<ReturnType<typeof build>>

/** In watch mode vite's `build()` returns a live watcher instead of a bundle. */
function isWatcher(
	result: BuildResult,
): result is Extract<BuildResult, { on: unknown }> {
	return "on" in result
}

/**
 * Build a plugin from `dir` (must contain `manifest.json` and optionally
 * `src/main.ts` / `index.html`). Output goes to `dir/dist/`.
 *
 * Pass `watch: true` to rebuild on file changes instead of exiting.
 */
export async function buildPlugin(
	dir: string,
	opts: { readonly watch: boolean },
): Promise<void> {
	const watchMode = opts.watch
	const manifestPath = join(dir, "manifest.json")
	if (!existsSync(manifestPath)) {
		throw new Error(`No manifest.json found in ${dir}`)
	}

	const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
	if (typeof manifest.id !== "string" || manifest.id.length === 0) {
		throw new Error("manifest.json missing id field")
	}
	lintTemplates(manifest as PluginManifest)

	const outDir = join(dir, "dist")

	if (!watchMode) {
		rmSync(outDir, { recursive: true, force: true })
	}
	mkdirSync(outDir, { recursive: true })

	const htmlEntry = join(dir, "index.html")
	const mainEntry = join(dir, "src", "main.ts")

	if (existsSync(htmlEntry)) {
		const result = await build({
			root: dir,
			base: "./",
			// React Compiler only on the iframe client build; the server
			// (SSR) bundle runs in a worker sandbox with no rendering.
			plugins: [
				react(),
				babel({ presets: [reactCompilerPreset()] }),
				tailwindcss(),
			],
			build: {
				outDir,
				emptyOutDir: false,
				chunkSizeWarningLimit: Infinity,
				rollupOptions: {
					input: htmlEntry,
				},
				watch: watchMode ? {} : null,
			},
		})
		if (watchMode && isWatcher(result)) {
			result.on("event", (event) => {
				if (event.code === "END") {
					console.log(`[watch] ${manifest.id} client rebuilt`)
				} else if (event.code === "ERROR") {
					console.error(`[watch] ${manifest.id} client error:`, event.error)
				}
			})
		}
	}

	if (existsSync(mainEntry)) {
		const result = await build({
			root: dir,
			plugins: [react()],
			build: {
				ssr: mainEntry,
				outDir,
				emptyOutDir: false,
				target: "node24",
				rollupOptions: {
					output: {
						entryFileNames: "main.js",
						chunkFileNames: "[name].js",
					},
					external: [],
				},
				watch: watchMode ? {} : null,
			},
		})
		assertNoNodeBuiltinImports(join(outDir))
		if (watchMode && isWatcher(result)) {
			result.on("event", (event) => {
				if (event.code === "END") {
					assertNoNodeBuiltinImports(join(outDir))
					console.log(`[watch] ${manifest.id} server rebuilt`)
				} else if (event.code === "ERROR") {
					console.error(`[watch] ${manifest.id} server error:`, event.error)
				}
			})
		}
	}

	copyFileSync(manifestPath, join(outDir, "manifest.json"))

	if (watchMode) {
		watch(manifestPath, () => {
			copyFileSync(manifestPath, join(outDir, "manifest.json"))
			console.log(`[watch] ${manifest.id} manifest updated`)
		})
		console.log(`[watch] ${manifest.id} watching for changes...`)
		await new Promise(() => {})
	}
	console.log(`${manifest.id} → ${outDir}`)
}

/**
 * Fail the build on malformed cover/search/message templates, warn on
 * i18n keys the manifest never declares. A bad template renders a
 * silent empty cover — catching it here beats discovering it in the
 * app.
 */
function lintTemplates(manifest: PluginManifest): void {
	const { templates, issues } = lintManifestTemplates(manifest)
	if (templates.length === 0) return
	const errors = issues.filter((issue) => !issue.message.includes("i18n key"))
	if (errors.length > 0) {
		const detail = errors
			.map((issue) => `  - ${issue.message}\n    ${issue.template}`)
			.join("\n")
		throw new Error(`manifest template validation failed:\n${detail}`)
	}
	for (const issue of issues.filter((issue) =>
		issue.message.includes("i18n key"),
	)) {
		console.warn(`[build] warning: ${issue.message}\n    ${issue.template}`)
	}
}

/**
 * Fail the build when the server bundle references Node builtins. The
 * plugin main process runs in a capability sandbox whose only privileged
 * interface is the host's ResourceAPI RPC, so `node:` imports and
 * `require` never have a legitimate home in a bundle (the Vite SSR build
 * inlines the SDK closure). The runtime module policy enforces the same
 * rule independently — this check is an early, friendly error.
 */
function assertNoNodeBuiltinImports(outDir: string): void {
	for (const file of readdirSync(outDir, { withFileTypes: true })) {
		if (!file.isFile() || !file.name.endsWith(".js")) continue
		const source = readFileSync(join(outDir, file.name), "utf-8")
		// Computed specifiers (`import("node:" + x)`) slip past a static
		// scan by design — the runtime policy gate still denies them.
		if (/(?:from\s*["']node:|import\s*\(\s*["']node:)/.test(source)) {
			throw new Error(
				`plugin main bundle (${file.name}) imports a Node builtin — the plugin main process cannot use node:fs/net/child_process/…; read files and probe metadata through the ResourceAPI instead`,
			)
		}
		if (/\brequire\s*\(/.test(source)) {
			throw new Error(
				`plugin main bundle (${file.name}) calls require() — the plugin main process is self-contained; use the ResourceAPI instead`,
			)
		}
	}
}
