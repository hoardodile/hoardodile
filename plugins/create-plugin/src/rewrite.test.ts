import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
	allowBuildsYaml,
	rewriteManifest,
	rewritePackageJson,
	THIRD_PARTY_VERSIONS,
	tarballOverridesYaml,
} from "./rewrite.ts"

describe("rewriteManifest", () => {
	it("regenerates the id and renames the plugin", () => {
		const manifest = rewriteManifest(
			{
				id: "6bc0c75e-5fca-4525-84f1-cfdd98661630",
				name: "Template",
				description: "Template plugin",
				version: "0.0.0",
				i18n: {
					name: { en: "Template", zh: "模板" },
					description: { en: "Template plugin", zh: "模板插件" },
				},
			},
			"my-plugin",
		)
		expect(manifest.id).not.toBe("6bc0c75e-5fca-4525-84f1-cfdd98661630")
		expect(manifest.id).toMatch(/^[0-9a-f-]{36}$/)
		expect(manifest.name).toBe("my-plugin")
		expect(manifest.version).toBe("0.0.1")
		expect(manifest.i18n?.name?.en).toBe("my-plugin")
	})

	it("is deterministic apart from the id", () => {
		const a = rewriteManifest(
			{ id: "x", name: "Template", description: "d", version: "0" },
			"p",
		)
		const b = rewriteManifest(
			{ id: "x", name: "Template", description: "d", version: "0" },
			"p",
		)
		expect(a.id).not.toBe(b.id)
		expect({ ...a, id: "" }).toEqual({ ...b, id: "" })
	})
})

describe("rewritePackageJson", () => {
	it("drops the prerelease suffix from npm SDK ranges", () => {
		const pkg = rewritePackageJson(
			{
				name: "t",
				version: "0.0.0",
				dependencies: {
					"@hoardodile/sdk-types": "workspace:*",
					react: "catalog:",
				},
			},
			"my-plugin",
			{ sdkVersion: "0.2.0-alpha.3" },
		)
		// `^0.2.0-alpha.3` would never match the 0.2.0 stable release.
		expect(pkg.dependencies?.["@hoardodile/sdk-types"]).toBe("^0.2.0")
	})

	it("keeps the exact version for tarball specs", () => {
		const pkg = rewritePackageJson(
			{
				name: "t",
				dependencies: { "@hoardodile/sdk-types": "workspace:*" },
			},
			"my-plugin",
			{ tarballsDir: "C:/sdks", sdkVersion: "0.2.0-alpha.3" },
		)
		expect(pkg.dependencies?.["@hoardodile/sdk-types"]).toBe(
			"file:C:/sdks/hoardodile-sdk-types-0.2.0-alpha.3.tgz",
		)
	})

	it("keeps the template's postinstall hook", () => {
		const pkg = rewritePackageJson(
			{
				name: "t",
				version: "0.0.0",
				postinstall: "node scripts/setup-hooks.mjs",
				devDependencies: { lefthook: "catalog:" },
			},
			"my-plugin",
			{ sdkVersion: "0.1.7" },
		)
		expect(pkg.postinstall).toBe("node scripts/setup-hooks.mjs")
	})
})

describe("workspace build approvals", () => {
	it("allowBuildsYaml approves lefthook and host's optional binaries", () => {
		const yaml = allowBuildsYaml()
		expect(yaml).toContain("'@hoardodile/ffprobe-bin': true")
		expect(yaml).toContain("'@hoardodile/ffmpeg-bin': true")
		expect(yaml).toContain("'@hoardodile/7z-bin': true")
		expect(yaml).toContain("'lefthook': true")
	})

	it("tarballOverridesYaml also approves lefthook in its allowBuilds", () => {
		const yaml = tarballOverridesYaml("C:/sdks", "0.1.7")
		expect(yaml).toContain("'lefthook': true")
	})
})

describe("THIRD_PARTY_VERSIONS", () => {
	const workspaceYaml = readFileSync(
		join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"..",
			"pnpm-workspace.yaml",
		),
		"utf8",
	)

	it("covers every catalog: dep the template declares", () => {
		// plugins/template is the single canonical source; its catalog: specs
		// must all have concrete mappings so a scaffolded plugin installs.
		const templatePkg = JSON.parse(
			readFileSync(
				join(
					dirname(fileURLToPath(import.meta.url)),
					"..",
					"..",
					"template",
					"package.json",
				),
				"utf8",
			),
		)
		const catalogSpecs = Object.entries({
			...templatePkg.dependencies,
			...templatePkg.devDependencies,
		})
			.filter(([, spec]) => spec === "catalog:")
			.map(([name]) => name)
		for (const name of catalogSpecs) {
			expect(
				THIRD_PARTY_VERSIONS[name],
				`missing mapping for ${name}`,
			).toBeDefined()
		}
	})

	it("stays aligned with the workspace catalog", () => {
		// When a dependency is upgraded in the catalog, this mapping must
		// follow — the scaffolded plugin would otherwise get a stale version.
		// Search only the `catalog:` block (allowBuilds lists the same dep
		// name with a `true` value, which must not be mistaken for a version).
		const catalogBlock = workspaceYaml.slice(workspaceYaml.indexOf("catalog:"))
		for (const [name, version] of Object.entries(THIRD_PARTY_VERSIONS)) {
			const catalogLine = catalogBlock
				.split("\n")
				.find((line) =>
					new RegExp(`^\\s*['"]?${name.replace("/", "\\/")}['"]?:`).test(line),
				)
			expect(catalogLine, `catalog has no entry for ${name}`).toBeDefined()
			const catalogVersion = catalogLine
				?.split(":")[1]
				?.trim()
				.replace(/["']/g, "")
			if (
				catalogVersion !== undefined &&
				!catalogVersion.includes("workspace")
			) {
				expect(
					version.includes(catalogVersion) ||
						catalogVersion.includes(version.replace("^", "")),
					`${name}: mapped ${version} vs catalog ${catalogVersion}`,
				).toBe(true)
			}
		}
	})
})
