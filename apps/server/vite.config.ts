import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs"
import { builtinModules, createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"
import {
	assertCopiedMediaBins,
	OPTIONAL_BIN_PACKAGES,
} from "./scripts/assert-media-bins.mjs"

const require = createRequire(import.meta.url)
const hostRequire = createRequire(
	path.resolve(import.meta.dirname, "../../plugins/host/package.json"),
)

const NATIVE_PACKAGES = ["better-sqlite3", "sharp", "@node-rs/argon2"] as const

const SKIP_NATIVE_DEPS = new Set<string>(OPTIONAL_BIN_PACKAGES)

/**
 * Compile-only / docs trees that better-sqlite3 and similar addons ship.
 * Do not add `bin`: `@hoardodile/7z-bin` keeps the 7-Zip executable there.
 */
const SKIP_NATIVE_TOP_LEVEL = new Set([
	"deps",
	"src",
	"build",
	"docs",
	"doc",
	"example",
	"examples",
	"test",
	"tests",
])

const NODE_BUILTINS = new Set([
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
])

/**
 * Copy the pre-built web UI from `apps/web/dist` into `dist/web/` so the
 * standalone CLI (`node dist/main.js`) automatically serves the SPA at
 * `/` without any extra configuration. When the web build has not been
 * produced yet (e.g. running `pnpm -F @hoardodile/server build` in
 * isolation) the plugin is a no-op rather than failing the server build,
 * since the CLI gracefully falls back to "tRPC/HTTP only" mode.
 */
function copyWebDistPlugin(): Plugin {
	return {
		name: "app-copy-web-dist",
		apply: "build",
		closeBundle() {
			const src = path.resolve(import.meta.dirname, "../web/dist")
			const dst = path.resolve(import.meta.dirname, "dist/web")
			if (!existsSync(src)) {
				console.warn(
					`[app-server] apps/web/dist not found at ${src}; skipping web bundle copy. Build apps/web first to embed the SPA.`,
				)
				return
			}
			copyDirRecursiveSync(src, dst)
		},
	}
}

/**
 * Copy `assets/` into `dist/assets` so standalone `node dist/main.js` can
 * serve them. No-op when the folder is absent.
 */
function copyServerAssetsPlugin(): Plugin {
	return {
		name: "app-copy-server-assets",
		apply: "build",
		closeBundle() {
			const src = path.resolve(import.meta.dirname, "assets")
			const dst = path.resolve(import.meta.dirname, "dist/assets")
			if (!existsSync(src)) {
				console.warn(
					`[app-server] apps/server/assets not found at ${src}; skipping asset copy.`,
				)
				return
			}
			copyDirRecursiveSync(src, dst)
		},
	}
}

/**
 * Copy runtime migrations: `*.sql` plus `meta/_journal.json`. Drizzle Kit
 * snapshots are generate-time only and are not shipped.
 * Bundled code resolves that folder from next to the emitting file, or from
 * the parent when the migrator lands in `dist/chunks/` (see
 * `resolveMigrationsFolder` in `connection.ts`).
 */
function copyMigrationSqlPlugin(): Plugin {
	return {
		name: "app-copy-migration-sql",
		apply: "build",
		closeBundle() {
			const src = path.resolve(import.meta.dirname, "src/infra/db/migrations")
			const dst = path.resolve(import.meta.dirname, "dist/migrations")
			copyDirRecursiveSync(src, dst, skipDrizzleKitSnapshot)
		},
	}
}

/**
 * Copy the untransformed plugin sandbox entry next to the server chunks so
 * `workerEntryUrlFromModule` can find it after `@hoardodile/host` is
 * inlined. The module policy hook lives inside the entry, so one file is
 * enough.
 */
function copyWorkerEntryPlugin(): Plugin {
	return {
		name: "app-copy-worker-entry",
		apply: "build",
		closeBundle() {
			const dst = path.resolve(
				import.meta.dirname,
				"dist/chunks/worker-entry.mjs",
			)
			mkdirSync(path.dirname(dst), { recursive: true })
			copyFileSync(resolveWorkerEntrySrc(), dst)
		},
	}
}

/**
 * Copy native addon packages (and this platform's optional `.node` trees)
 * plus spawned-binary installer packages into `dist/node_modules` so
 * `node dist/main.js` does not need the workspace install.
 */
function copyNativePackagesPlugin(): Plugin {
	return {
		name: "app-copy-native-packages",
		apply: "build",
		closeBundle() {
			const destRoot = path.resolve(import.meta.dirname, "dist/node_modules")
			mkdirSync(destRoot, { recursive: true })
			for (const name of NATIVE_PACKAGES) {
				copyPackageWithNativeDeps(name, destRoot)
			}
			copyOptionalBinPackages(destRoot)
		},
	}
}

/**
 * Copy host optionalDependencies that export a spawned binary (ffmpeg,
 * ffprobe, 7-Zip). Fail the build when a package or its binary is missing
 * — unlike native addons, these are required for video thumbs and archive
 * extraction. Copies the package directory only; install-time JS deps
 * (`http-basic`, …) are not needed at runtime.
 */
function copyOptionalBinPackages(destRoot: string): void {
	for (const name of OPTIONAL_BIN_PACKAGES) {
		const owner =
			name === "@hoardodile/restic-bin"
				? "backup"
				: name === "@hoardodile/rclone-bin"
					? "sync"
					: undefined
		const resolver =
			owner === undefined
				? hostRequire
				: createRequire(
						path.resolve(
							import.meta.dirname,
							`../../packages/${owner}/package.json`,
						),
					)
		const srcDir = resolvePackageDir(name, resolver)
		if (srcDir === undefined) {
			throw new Error(
				`[app-server] required binary package ${name} not found; run pnpm install with optional dependencies enabled`,
			)
		}
		copyPackageDir(name, srcDir, destRoot)
	}
	assertCopiedMediaBins(destRoot)
}

function resolveWorkerEntrySrc(): string {
	try {
		return fileURLToPath(import.meta.resolve("@hoardodile/host/worker-entry"))
	} catch {
		return path.resolve(
			import.meta.dirname,
			"../../plugins/host/src/sandbox/worker-entry.mjs",
		)
	}
}

function isNativePackageId(id: string): boolean {
	for (const name of NATIVE_PACKAGES) {
		if (id === name || id.startsWith(`${name}/`)) return true
	}
	return false
}

function isOptionalBinPackageId(id: string): boolean {
	for (const name of OPTIONAL_BIN_PACKAGES) {
		if (id === name || id.startsWith(`${name}/`)) return true
	}
	return false
}

function copyPackageWithNativeDeps(pkgName: string, destRoot: string): void {
	const srcDir = resolvePackageDir(pkgName)
	if (srcDir === undefined) {
		console.warn(`[app-server] native package ${pkgName} not found; skipping`)
		return
	}
	copyPackageDir(pkgName, srcDir, destRoot)
	const manifest = readPackageManifest(path.join(srcDir, "package.json"))
	const fromPkg = createRequire(path.join(srcDir, "package.json"))
	for (const dep of Object.keys({
		...manifest.optionalDependencies,
		...manifest.dependencies,
	})) {
		if (SKIP_NATIVE_DEPS.has(dep)) continue
		if (!shouldCopyNativeDep(pkgName, dep)) continue
		const depDir = resolvePackageDir(dep, fromPkg, srcDir)
		if (depDir === undefined) continue
		copyPackageDir(dep, depDir, destRoot)
	}
}

function resolvePackageDir(
	pkgName: string,
	resolver: NodeJS.Require = require,
	fromDir?: string,
): string | undefined {
	try {
		return path.dirname(resolver.resolve(`${pkgName}/package.json`))
	} catch {
		// sharp (and some NAPI packages) omit package.json from "exports".
	}
	try {
		const entry = resolver.resolve(pkgName)
		let current = path.dirname(entry)
		while (true) {
			const candidate = path.join(current, "package.json")
			if (existsSync(candidate)) {
				const manifest = readPackageManifest(candidate)
				if (manifest.name === pkgName) return current
			}
			const parent = path.dirname(current)
			if (parent === current) break
			current = parent
		}
	} catch {
		// No main export (native @img/sharp-* packages).
	}
	if (fromDir !== undefined) {
		const segments = pkgName.split("/")
		const nested = path.join(fromDir, "node_modules", ...segments)
		if (existsSync(path.join(nested, "package.json"))) return nested
		const sibling = path.join(path.dirname(fromDir), ...segments)
		if (existsSync(path.join(sibling, "package.json"))) return sibling
	}
	return undefined
}

function copyPackageDir(
	pkgName: string,
	srcDir: string,
	destRoot: string,
): void {
	const destDir = path.join(destRoot, ...pkgName.split("/"))
	mkdirSync(destDir, { recursive: true })
	for (const entry of readdirSync(srcDir)) {
		if (entry === "node_modules") continue
		if (SKIP_NATIVE_TOP_LEVEL.has(entry)) continue
		if (isNativeJunkFile(entry)) continue
		const srcEntry = path.join(srcDir, entry)
		const destEntry = path.join(destDir, entry)
		if (
			pkgName === "better-sqlite3" &&
			entry === "prebuilds" &&
			statSync(srcEntry).isDirectory()
		) {
			copyCurrentPlatformPrebuilds(srcEntry, destEntry)
			continue
		}
		cpSync(srcEntry, destEntry, {
			recursive: true,
			dereference: true,
		})
	}
	console.log(`[app-server] copied native ${pkgName}`)
}

function isNativeJunkFile(name: string): boolean {
	const lower = name.toLowerCase()
	return (
		lower === "binding.gyp" ||
		lower === "readme.md" ||
		lower === "changelog.md" ||
		lower.endsWith(".map")
	)
}

/**
 * better-sqlite3 loads `prebuilds/${platform}-${arch}.node` (linux musl uses
 * `linuxmusl`). Other-arch binaries and the sqlite amalgamation under `deps/`
 * are compile-time only.
 */
function copyCurrentPlatformPrebuilds(srcDir: string, destDir: string): void {
	const name = currentSqlitePrebuildName()
	const srcFile = path.join(srcDir, name)
	if (!existsSync(srcFile)) {
		console.warn(
			`[app-server] better-sqlite3 prebuild ${name} not found; copying all prebuilds`,
		)
		cpSync(srcDir, destDir, { recursive: true, dereference: true })
		return
	}
	mkdirSync(destDir, { recursive: true })
	copyFileSync(srcFile, path.join(destDir, name))
}

function currentSqlitePrebuildName(): string {
	const plat = isLinuxMuslHost() ? "linuxmusl" : process.platform
	return `${plat}-${process.arch}.node`
}

function isLinuxMuslHost(): boolean {
	if (process.platform !== "linux") return false
	const report: unknown = process.report?.getReport()
	if (!isPlainRecord(report) || !isPlainRecord(report.header)) return false
	return report.header.glibcVersionRuntime === undefined
}

function skipDrizzleKitSnapshot(relativePath: string): boolean {
	return (
		relativePath.startsWith("meta/") &&
		relativePath.endsWith(".json") &&
		relativePath !== "meta/_journal.json"
	)
}

function shouldCopyNativeDep(pkgName: string, dep: string): boolean {
	if (pkgName === "sharp") {
		return dep.startsWith("@img/") || dep === "detect-libc" || dep === "semver"
	}
	if (pkgName === "@node-rs/argon2") {
		return dep.startsWith("@node-rs/argon2-") || dep === "@node-rs/helper"
	}
	if (pkgName === "better-sqlite3") return dep === "bindings"
	return false
}

function readPackageManifest(pkgJsonPath: string): {
	name?: string
	optionalDependencies?: Record<string, string>
	dependencies?: Record<string, string>
} {
	const raw: unknown = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
	if (!isPlainRecord(raw)) return {}
	return {
		name: typeof raw.name === "string" ? raw.name : undefined,
		optionalDependencies: stringRecord(raw.optionalDependencies),
		dependencies: stringRecord(raw.dependencies),
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (value === undefined || value === null || typeof value !== "object") {
		return undefined
	}
	const out: Record<string, string> = {}
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") out[key] = entry
	}
	return out
}

function copyDirRecursiveSync(
	src: string,
	dst: string,
	skip?: (relativePath: string) => boolean,
	relativePath = "",
): void {
	mkdirSync(dst, { recursive: true })
	for (const entry of readdirSync(src)) {
		const childRel = relativePath === "" ? entry : `${relativePath}/${entry}`
		if (skip?.(childRel)) continue
		const srcEntry = path.join(src, entry)
		const dstEntry = path.join(dst, entry)
		if (statSync(srcEntry).isDirectory()) {
			copyDirRecursiveSync(srcEntry, dstEntry, skip, childRel)
		} else {
			copyFileSync(srcEntry, dstEntry)
		}
	}
}

export default defineConfig(({ command }) => ({
	define: {
		__HOARD_SERVER_BUNDLE__: JSON.stringify(command === "build"),
	},
	resolve: {
		alias: {
			src: path.resolve(import.meta.dirname, "src"),
		},
	},
	ssr: {
		target: "node",
		noExternal: true,
		external: [...NATIVE_PACKAGES, ...OPTIONAL_BIN_PACKAGES],
	},
	test: {
		// bootstrap() + buildServer() often exceeds the default 5s under Windows
		// and when turbo test runs packages in parallel.
		testTimeout: 30_000,
		hookTimeout: 30_000,
		pool: "threads",
		// Default is cores-1 workers; turbo runs several packages' tests in
		// parallel, so cap each vitest run to keep the machine responsive.
		maxWorkers: 2,
		// Insight tool, not a CI gate: `pnpm -F @hoardodile/server test:coverage`
		// runs the suite under v8 instrumentation so hot spots like the tag
		// rule graphs, merge and sync snapshots can show their real coverage.
		coverage: {
			provider: "v8",
			include: ["src/domain/**", "src/infra/storage/**"],
			reporter: ["text-summary", "html"],
		},
	},
	// `vite-node --watch` runs a real vite dev server, so this also governs
	// its file watcher. Atomic-save temp artifacts (plus their dot-dir
	// variants) must never be watched mid-write — EBUSY would kill the
	// backend dev loop.
	server: {
		watch: {
			ignored: ["**/*.tmpdir/**", "**/.*.tmpdir/**", "**/*.tmp"],
		},
	},
	plugins: [
		copyMigrationSqlPlugin(),
		copyWorkerEntryPlugin(),
		copyNativePackagesPlugin(),
		copyServerAssetsPlugin(),
		copyWebDistPlugin(),
	],
	build: {
		ssr: true,
		target: "node24",
		rollupOptions: {
			input: {
				index: path.resolve(import.meta.dirname, "src/index.ts"),
				main: path.resolve(import.meta.dirname, "src/main.ts"),
				"reset-main": path.resolve(import.meta.dirname, "src/reset-main.ts"),
			},
			external(id) {
				if (path.isAbsolute(id) || id.startsWith(".") || id.startsWith("\0")) {
					return false
				}
				if (id.startsWith("src/") || id === "src") return false
				if (
					isNativePackageId(id) ||
					isOptionalBinPackageId(id) ||
					NODE_BUILTINS.has(id)
				) {
					return true
				}
				return false
			},
			output: {
				entryFileNames: "[name].js",
				chunkFileNames: "chunks/[name]-[hash].js",
				format: "es",
			},
		},
		outDir: "dist",
		sourcemap: true,
		minify: true,
	},
}))
