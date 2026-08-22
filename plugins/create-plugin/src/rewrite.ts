/**
 * Scaffold-time rewrites applied to the embedded template copy: fresh
 * manifest identity and concrete dependency specs (the template uses
 * `workspace:*` / `catalog:` which only resolve inside the monorepo).
 */
import { join } from "node:path"
import { SDK_DEP_NAMES } from "./sdk-deps.gen.ts"

/** Concrete versions for the catalog: specs the template uses. */
export const THIRD_PARTY_VERSIONS: Readonly<Record<string, string>> = {
	"@types/node": "^26.1.2",
	"@types/react": "^19.2.18",
	"@types/react-dom": "^19.2.4",
	jsdom: "^30.0.1",
	react: "^19.2.8",
	"react-dom": "^19.2.8",
	typescript: "^7.0.2",
	vite: "^8.2.0",
	vitest: "^4.1.10",
}

export type ManifestShape = {
	id: string
	name: string
	description: string
	version: string
	i18n?: {
		name?: Record<string, string>
		description?: Record<string, string>
	}
}

export function rewriteManifest(
	manifest: ManifestShape,
	pluginName: string,
): ManifestShape {
	manifest.id = crypto.randomUUID()
	manifest.name = pluginName
	manifest.description = `Content plugin: ${pluginName}`
	if (manifest.i18n?.name !== undefined) {
		manifest.i18n.name.en = pluginName
	}
	if (manifest.i18n?.description !== undefined) {
		manifest.i18n.description.en = `Content plugin: ${pluginName}`
	}
	manifest.version = "0.0.1"
	return manifest
}

export type PackageJson = {
	name: string
	version?: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}

export function tarballSpec(
	tarballsDir: string,
	dep: string,
	version: string,
): string {
	const fileName = dep.replace("@", "").replace("/", "-")
	return `file:${join(tarballsDir, `${fileName}-${version}.tgz`).replaceAll("\\", "/")}`
}

function rewriteDepBlock(
	deps: Record<string, string> | undefined,
	tarballsDir: string | undefined,
	sdkVersion: string,
): Record<string, string> {
	const out = { ...deps }
	for (const [dep, spec] of Object.entries(out)) {
		if (SDK_DEP_NAMES.includes(dep)) {
			out[dep] =
				tarballsDir !== undefined
					? tarballSpec(tarballsDir, dep, sdkVersion)
					: // `^0.2.0-alpha.3` would never match the 0.2.0 stable
						// release (semver keeps prereleases out of plain ranges),
						// so npm specs drop the prerelease suffix.
						`^${sdkVersion.split("-")[0]}`
		} else if (spec === "catalog:") {
			const version = THIRD_PARTY_VERSIONS[dep]
			if (version === undefined) {
				throw new Error(
					`template dependency "${dep}" has no concrete version mapping`,
				)
			}
			out[dep] = version
		}
	}
	return out
}

export function rewritePackageJson(
	pkg: PackageJson,
	pluginName: string,
	opts: { readonly tarballsDir?: string; readonly sdkVersion: string },
): PackageJson {
	pkg.name = pluginName
	delete pkg.version
	pkg.version = "0.0.1"
	if (pkg.dependencies !== undefined) {
		pkg.dependencies = rewriteDepBlock(
			pkg.dependencies,
			opts.tarballsDir,
			opts.sdkVersion,
		)
	}
	if (pkg.devDependencies !== undefined) {
		pkg.devDependencies = rewriteDepBlock(
			pkg.devDependencies,
			opts.tarballsDir,
			opts.sdkVersion,
		)
	}
	return pkg
}

/**
 * Install-script dependencies that land in a scaffolded plugin through
 * host's optionalDependencies (the same names as the root workspace's
 * allowBuilds). pnpm refuses to run their build scripts without an
 * explicit approval, so the generated workspace approves them up front.
 */
const ALLOWED_BUILDS = [
	"@derhuerst/ffprobe-static",
	"@hoardodile/7z-bin",
	"ffmpeg-static",
]

export function tarballOverridesYaml(
	tarballsDir: string,
	sdkVersion: string,
): string {
	const lines = SDK_DEP_NAMES.map(
		(dep) => `  '${dep}': '${tarballSpec(tarballsDir, dep, sdkVersion)}'`,
	).join("\n")
	const builds = ALLOWED_BUILDS.map((dep) => `  '${dep}': true`).join("\n")
	return [
		"# Redirect the cross-SDK 0.0.0 specs packed into the tarballs to the",
		"# sibling tarballs in this workspace; approve the install scripts of",
		"# host's optional binaries (ffmpeg/ffprobe/7-Zip) so pnpm runs them.",
		"overrides:",
		lines,
		"allowBuilds:",
		builds,
		"",
	].join("\n")
}
