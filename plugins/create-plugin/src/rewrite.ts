/**
 * Scaffold-time rewrites applied to the embedded template copy: fresh
 * manifest identity and concrete dependency specs (the template uses
 * `workspace:*` / `catalog:` which only resolve inside the monorepo).
 */
import { join } from "node:path"
import { SDK_DEP_NAMES } from "./sdk-deps.gen.ts"

/** Concrete versions for the catalog: specs the template uses. */
export const THIRD_PARTY_VERSIONS: Readonly<Record<string, string>> = {
	"@biomejs/biome": "2.5.10",
	"@release-it/conventional-changelog": "^12.0.0",
	"@types/node": "^26.2.0",
	"@types/react": "^19.2.18",
	"@types/react-dom": "^19.2.4",
	jsdom: "^30.0.1",
	lefthook: "^2.1.10",
	"lint-staged": "^17.3.0",
	react: "^19.2.8",
	"react-dom": "^19.2.8",
	"release-it": "^21.0.2",
	typescript: "^7.0.2",
	vite: "^8.2.2",
	vitest: "^4.1.11",
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
	postinstall?: string
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
 * A standalone (non-workspace) plugin repo needs its build-script approvals in
 * a `pnpm-workspace.yaml`: pnpm 11 blocks dependency install scripts by
 * default and ignores the equivalent package.json `pnpm.onlyBuiltDependencies`
 * field. The scaffolder writes this file on the normal registry path (the
 * --tarballs path writes an equivalent `allowBuilds` alongside its overrides).
 */
export function allowBuildsYaml(): string {
	const builds = ALLOWED_BUILDS.map((dep) => `  '${dep}': true`).join("\n")
	return [
		"# Approve the install scripts pnpm 11 blocks by default: host's optional",
		"# binaries (ffmpeg/ffprobe/7-Zip) and lefthook's platform binary.",
		"allowBuilds:",
		builds,
		"",
	].join("\n")
}

/**
 * Install-script dependencies that land in a scaffolded plugin: host's
 * optional binaries plus lefthook (the git-hooks runner, whose postinstall
 * fetches the platform binary). pnpm refuses to run their build scripts
 * without an explicit approval, so the generated workspace approves them
 * all up front (mirroring the root workspace's allowBuilds).
 */
const ALLOWED_BUILDS = [
	"@hoardodile/ffmpeg-bin",
	"@hoardodile/ffprobe-bin",
	"@hoardodile/7z-bin",
	"lefthook",
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
		"# host's optional binaries (ffmpeg/ffprobe/7-Zip) and lefthook so pnpm",
		"# runs them.",
		"overrides:",
		lines,
		"allowBuilds:",
		builds,
		"",
	].join("\n")
}
