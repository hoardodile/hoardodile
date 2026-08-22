/**
 * Developer/operator CLI: fill an *empty* storage root with the official
 * demo library. Not a product feature — no UI, not shipped in the desktop
 * install, not in the production server bundle.
 *
 *   pnpm seed
 *   pnpm seed -- --storage ./tmp/demo-storage
 *   pnpm seed -- --skip-download
 *   pnpm seed -- --dry-run
 */

import { join } from "node:path"
import {
	loadEnv,
	loadWorkspaceEnvFile,
	resolveWorkspaceRoot,
} from "src/config/env.ts"
import {
	catalogCopies,
	catalogFacets,
	catalogMedia,
	resources,
} from "./seed/catalog.ts"
import { resolveMedia } from "./seed/download.ts"
import { fillDemoLibrary, missingFacets } from "./seed/fill.ts"
import {
	assertNotPackaged,
	inspectSeedRoot,
	prepareSeedRoot,
} from "./seed/fresh.ts"
import { openSeedRuntime } from "./seed/runtime.ts"

type SeedArgs = {
	readonly skipDownload: boolean
	readonly dryRun: boolean
	readonly storage: string | undefined
}

function parseArgs(argv: readonly string[]): SeedArgs {
	let skipDownload = false
	let dryRun = false
	let storage: string | undefined
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]
		if (arg === undefined) continue
		if (arg === "--skip-download") skipDownload = true
		else if (arg === "--dry-run") dryRun = true
		else if (arg === "--storage") {
			const next = argv[i + 1]
			if (next === undefined || next.startsWith("--")) {
				throw new Error("seed: --storage requires a directory path")
			}
			storage = next
			i += 1
		} else if (arg.startsWith("--storage=")) {
			const value = arg.slice("--storage=".length)
			if (value.length === 0) {
				throw new Error("seed: --storage requires a directory path")
			}
			storage = value
		} else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"Usage: pnpm seed [-- --skip-download] [-- --dry-run] [-- --storage <dir>]\nFill an empty storage root with the official demo library. Admin password is demo.\n",
			)
			process.exit(0)
		} else {
			throw new Error(`seed: unknown argument ${arg}`)
		}
	}
	return { skipDownload, dryRun, storage }
}

function isBusy(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err)
	return (
		message.includes("SQLITE_BUSY") ||
		message.includes("database is locked") ||
		message.includes("SQLITE_LOCKED")
	)
}

function cacheDir(): string {
	return join(resolveWorkspaceRoot(), "tmp", "seed-cache")
}

async function runDry(root: string, args: SeedArgs): Promise<void> {
	const state = inspectSeedRoot(root)
	process.stdout.write(`seed: dry-run target ${root}\n`)
	process.stdout.write(`  path: ${state.kind}\n`)
	process.stdout.write(`  resources: ${Object.keys(resources).length}\n`)
	process.stdout.write(`  copies: ${catalogCopies().length}\n`)
	process.stdout.write(`  facets: ${catalogFacets().join(", ")}\n`)
	if (args.skipDownload) return
	const resolved = await resolveMedia(catalogMedia(), {
		cacheDir: cacheDir(),
		skipDownload: false,
	})
	for (const warning of resolved.warnings) {
		process.stdout.write(`  skip ${warning.title}: ${warning.message}\n`)
	}
	for (const [title, file] of resolved.files) {
		process.stdout.write(
			`  ok ${title} (${file.license}, ${file.bytes} bytes)\n`,
		)
	}
}

async function main(): Promise<void> {
	assertNotPackaged()
	loadWorkspaceEnvFile()
	const args = parseArgs(process.argv.slice(2))
	if (args.storage !== undefined) {
		process.env.STORAGE_ROOT = args.storage
	}
	const env = loadEnv(process.env)
	if (args.dryRun) {
		await runDry(env.STORAGE_ROOT, args)
		return
	}
	prepareSeedRoot(env.STORAGE_ROOT, { dryRun: false })
	const rt = await openSeedRuntime(env)
	try {
		const created = await fillDemoLibrary(rt, {
			skipDownload: args.skipDownload,
			cacheDir: cacheDir(),
		})
		const missing = missingFacets(created)
		if (missing.length > 0) {
			throw new Error(
				`seed: gallery facets missing after fill: ${missing.join(", ")}`,
			)
		}
	} catch (err) {
		if (isBusy(err)) {
			process.stderr.write(
				"seed: database is locked. Stop pnpm dev and retry.\n",
			)
		}
		throw err
	} finally {
		await rt.close()
	}
}

main().catch((err: unknown) => {
	const message =
		err instanceof Error ? (err.stack ?? err.message) : String(err)
	process.stderr.write(`${message}\n`)
	process.exitCode = 1
})
