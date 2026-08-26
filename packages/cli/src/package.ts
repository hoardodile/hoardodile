import { createHash } from "node:crypto"
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs"
import { writeFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import type { PluginManifest } from "@hoardodile/sdk-types"
import { zipSync } from "fflate"
import { buildPlugin } from "./build.ts"
import { CliError } from "./runner.ts"

export type PackageResult = {
	readonly id: string
	readonly version: string
	readonly zipPath: string
	/** `release/<id>-<version>.zip.sha256` next to the zip. */
	readonly sha256Path: string
	/** Publishing hint: push a matching tag — the release workflow builds. */
	readonly publishHint: string
	/** One line to append to the marketplace registry `plugins` array. */
	readonly registryLine: string
}

/**
 * Build (or reuse) a plugin's `dist/`, then zip its *contents* —
 * `manifest.json` at the zip root, exactly what the app's installer
 * expects — into `release/<id>-<version>.zip` plus a `<zip>.sha256`
 * sidecar (the marketplace verifies it when the release ships one).
 *
 * The file name is the marketplace convention: the app resolves a
 * release's zip by trying `<id>-<tag>.zip` / `<id>-<version>.zip`
 * first, so publishing with this artifact needs no registry metadata.
 *
 * Publishing itself is a CI concern: the template ships a tag-triggered
 * release workflow (`plugins/template/.github/workflows/release.yml`)
 * that uploads both artifacts — no local `gh` CLI or token needed.
 */
export async function packPlugin(
	dir: string,
	opts: { readonly skipBuild: boolean },
): Promise<PackageResult> {
	const pluginDir = resolve(dir)
	const manifestPath = join(pluginDir, "manifest.json")
	if (!existsSync(manifestPath)) {
		throw new CliError(`No manifest.json found in ${pluginDir}`)
	}
	const manifest = JSON.parse(
		readFileSync(manifestPath, "utf-8"),
	) as PluginManifest
	if (typeof manifest.id !== "string" || manifest.id.length === 0) {
		throw new CliError("manifest.json missing id field")
	}
	if (typeof manifest.version !== "string" || manifest.version.length === 0) {
		throw new CliError("manifest.json missing version field")
	}

	if (!opts.skipBuild) {
		await buildPlugin(pluginDir, { watch: false })
	}

	const distDir = join(pluginDir, "dist")
	if (!existsSync(join(distDir, "manifest.json"))) {
		throw new CliError(
			`dist/manifest.json not found in ${pluginDir} — run "hoardodile plugin build" first`,
		)
	}

	const outDir = join(pluginDir, "release")
	mkdirSync(outDir, { recursive: true })
	const zipPath = join(
		outDir,
		`${manifest.id}-${sanitizeFileNamePart(manifest.version)}.zip`,
	)

	// Zip only the files `dist/` produced; entries use forward slashes so
	// the archive is identical on every platform.
	const files = zipFiles(distDir, distDir)
	rmSync(zipPath, { force: true })
	const packed = zipSync(files, { level: 9 })
	await writeFile(zipPath, packed)

	const sha256Path = `${zipPath}.sha256`
	await writeFile(
		sha256Path,
		`${createHash("sha256").update(packed).digest("hex")}\n`,
	)

	return {
		id: manifest.id,
		version: manifest.version,
		zipPath,
		sha256Path,
		publishHint: `push a tag v${manifest.version} — the release workflow (plugins/template/.github/workflows/release.yml) builds and publishes`,
		registryLine: registryLineFor(pluginDir),
	}
}

function zipFiles(
	rootDir: string,
	currentDir: string,
): Record<string, Uint8Array> {
	const files: Record<string, Uint8Array> = {}
	for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
		const fullPath = join(currentDir, entry.name)
		if (entry.isDirectory()) {
			Object.assign(files, zipFiles(rootDir, fullPath))
		} else if (entry.isFile()) {
			const rel = fullPath
				.slice(rootDir.length + 1)
				.split(sep)
				.join("/")
			files[rel] = readFileSync(fullPath)
		}
	}
	return files
}

/** Derive the registry line from package.json's repository, if present. */
function registryLineFor(pluginDir: string): string {
	try {
		const pkg = JSON.parse(
			readFileSync(join(pluginDir, "package.json"), "utf-8"),
		) as { readonly repository?: { readonly url?: string } | string }
		const url =
			typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url
		if (typeof url === "string") {
			const match = url.match(/github\.com[:/]([^/]+)\/([^/#.]+)/)
			if (match !== null) {
				return `"https://github.com/${match[1]}/${match[2]}"`
			}
		}
	} catch {
		// No package.json (or unreadable) — fall through to the placeholder.
	}
	return '"https://github.com/<owner>/<repo>"'
}

function sanitizeFileNamePart(value: string): string {
	const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-")
	return sanitized.length > 0 ? sanitized : "0"
}
