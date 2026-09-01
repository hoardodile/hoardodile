#!/usr/bin/env node
/**
 * `create-hoardodile-plugin` — scaffold a new content plugin from the
 * template copy shipped in `dist/template`, generated from the canonical
 * `plugins/template` by scripts/copy-template.mjs at build time.
 *
 * Flow: interactive prompts (name, id auto-generated) → copy template →
 * rewrite manifest + package.json → install dependencies → validate the
 * manifest → print the dev loop entry points.
 *
 *   create-hoardodile-plugin my-plugin
 *   create-hoardodile-plugin my-plugin --tarballs ../hoardodile/tmp/sdks
 *
 * `--tarballs <dir>` rewires the SDK deps to packed tarballs plus a
 * pnpm-workspace.yaml with the cross-package overrides — used by the
 * release smoke test and for offline installs.
 */
import { spawn } from "node:child_process"
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	cancel,
	confirm,
	intro,
	isCancel,
	log,
	outro,
	text,
} from "@clack/prompts"
import { pluginManifest } from "@hoardodile/sdk-types/schema"
import { STANDALONE_BIOME_JSON } from "./biome-template.ts"
import {
	allowBuildsYaml,
	rewriteManifest,
	rewritePackageJson,
	tarballOverridesYaml,
} from "./rewrite.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
// The template ships inside dist (dist/template) — the bin always runs
// from the built artifact, so resolve relative to this module.
const TEMPLATE_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"template",
)
const SELF_VERSION = JSON.parse(
	readFileSync(join(ROOT, "package.json"), "utf8"),
).version

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`)
}

function writeWorkspaceConfig(targetDir: string, tarballsDir?: string): void {
	// pnpm 11 blocks dependency install scripts and ignores the package.json
	// `pnpm.onlyBuiltDependencies` field, so approve them through an
	// allowBuilds workspace file. The --tarballs path also rewires the SDK
	// deps to the packed tarballs (same allowBuilds, plus file: overrides).
	writeFileSync(
		join(targetDir, "pnpm-workspace.yaml"),
		tarballsDir !== undefined
			? tarballOverridesYaml(tarballsDir, SELF_VERSION)
			: allowBuildsYaml(),
	)
}

async function runInstall(targetDir: string): Promise<void> {
	log.step("Installing dependencies (pnpm install)")
	return new Promise<void>((resolveDone, reject) => {
		const child = spawn("pnpm", ["install"], {
			cwd: targetDir,
			stdio: "inherit",
			shell: process.platform === "win32",
		})
		child.on("error", reject)
		child.on("exit", (code) =>
			code === 0
				? resolveDone()
				: reject(new Error(`pnpm install exited ${code}`)),
		)
	})
}

export async function main() {
	const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"))
	const tarballsFlag = process.argv.indexOf("--tarballs")
	const tarballsDir =
		tarballsFlag !== -1
			? resolve(process.argv[tarballsFlag + 1] ?? "")
			: undefined

	intro("hoardodile plugin scaffold")

	const providedName = positional[0]
	const pluginName =
		providedName ??
		(await text({
			message: "Plugin name (also the directory name, npm-style):",
			validate: (v) =>
				/^[a-z0-9][a-z0-9-]*$/.test(v ?? "")
					? undefined
					: "lowercase letters, digits and dashes only",
		}))
	if (isCancel(pluginName)) {
		cancel("scaffold cancelled")
		process.exit(1)
	}

	const targetDir = resolve(pluginName)
	if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
		const proceed = await confirm({
			message: `${targetDir} is not empty — scaffold into it anyway?`,
			initialValue: false,
		})
		if (isCancel(proceed) || !proceed) {
			cancel("scaffold cancelled")
			process.exit(1)
		}
	}

	log.step(`Copying template into ${targetDir}`)
	mkdirSync(targetDir, { recursive: true })
	// dist/template is a build artifact (already filtered when copied in);
	// copy it wholesale so template source dirs inside it survive.
	cpSync(TEMPLATE_DIR, targetDir, { recursive: true })

	log.step("Rewriting manifest and package.json")
	const manifestPath = join(targetDir, "manifest.json")
	const pkgPath = join(targetDir, "package.json")
	writeJson(
		manifestPath,
		rewriteManifest(JSON.parse(readFileSync(manifestPath, "utf8")), pluginName),
	)
	writeJson(
		pkgPath,
		rewritePackageJson(JSON.parse(readFileSync(pkgPath, "utf8")), pluginName, {
			tarballsDir,
			sdkVersion: SELF_VERSION,
		}),
	)
	// A standalone plugin repo has no root biome.json (biome rejects a nested
	// config when the monorepo's root one exists), so the scaffolder ships the
	// toolchain config directly into each generated plugin.
	writeFileSync(join(targetDir, "biome.json"), STANDALONE_BIOME_JSON)

	const parsed = pluginManifest.safeParse(
		JSON.parse(readFileSync(manifestPath, "utf8")),
	)
	if (!parsed.success) {
		process.exitCode = 1
		log.error(`generated manifest is invalid: ${parsed.error.message}`)
		return
	}

	if (tarballsDir !== undefined) {
		log.step(`Rewiring SDK deps to tarballs in ${tarballsDir}`)
	}
	writeWorkspaceConfig(targetDir, tarballsDir)

	try {
		await runInstall(targetDir)
	} catch (err) {
		process.exitCode = 1
		log.error(
			`install failed: ${err instanceof Error ? err.message : String(err)}`,
		)
		return
	}

	outro("Plugin scaffolded. Next steps:")
	console.log(`  cd ${targetDir}`)
	console.log(
		"  pnpm build          # build dist/ (client + server bundle + manifest)",
	)
	console.log(
		"  pnpm dev            # watch-build + serve the workbench (http://127.0.0.1:5199)",
	)
	console.log("  pnpm test           # unit tests against the fixture API")
	console.log("  hoardodile plugin run detect testdata --plugin-dir dist")
	console.log(
		"  # Replace the manifest id? No — it was generated fresh. Zip dist/ contents and upload in Settings → Plugins.",
	)
}

if (
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((err) => {
		log.error(err instanceof Error ? err.message : String(err))
		process.exit(1)
	})
}
