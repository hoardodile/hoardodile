import {
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statfsSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"
import {
	SWAP_ENTRIES,
	swapBackupRoot,
	swapMarkerPath,
} from "./resource-support.ts"

/**
 * In-place swap of the resource payload (node/ server/ plugins/ and the
 * resources-version marker) under `resources/`. Pure file surgery: the
 * caller orchestrates sidecar stop/start and health around `beginSwap` /
 * `commitSwap` / `rollbackSwap`, and runs `recoverAtBoot` on start.
 *
 * Crash-safety: `.swap-pending` is written BEFORE any rename and removed
 * only after the new tree is committed; `.olds/` keeps the previous tree
 * until the soak window passes. Every intermediate state is idempotently
 * recoverable (see recoverAtBoot).
 */

const RENAME_RETRIES = 3
const RENAME_RETRY_DELAY_MS = 500

export type SwapBeginOptions = {
	readonly resourcesRoot: string
	/** Extracted pack tree (same volume: it lives inside resources/). */
	readonly stagingRoot: string
	readonly version: string
}

export type RecoveryAction = "none" | "rolled-back" | "committed"

export function assertSwapSpace(options: {
	readonly resourcesRoot: string
	readonly stagingRoot: string
}): void {
	const required =
		dirSize(options.stagingRoot) +
		dirSize(options.resourcesRoot) +
		64 * 1024 * 1024
	const free = freeBytes(options.resourcesRoot)
	if (free < required) {
		throw new Error(
			`not enough disk space for the resource swap (free ${free}, need ${required})`,
		)
	}
}

/** Marker first, then move current → .olds, then staging → current. */
export function beginSwap(options: SwapBeginOptions): void {
	const { resourcesRoot, stagingRoot, version } = options
	if (!existsSync(join(stagingRoot, "server", "main.js"))) {
		throw new Error(`staging tree is incomplete: ${stagingRoot}`)
	}
	writeMarker(resourcesRoot, version, stagingRoot)
	rmSync(backupPath(resourcesRoot), { recursive: true, force: true })
	mkdirSync(backupPath(resourcesRoot), { recursive: true })
	for (const entry of SWAP_ENTRIES) {
		renameRetry(
			join(resourcesRoot, entry),
			join(backupPath(resourcesRoot), entry),
		)
	}
	for (const entry of SWAP_ENTRIES) {
		renameRetry(join(stagingRoot, entry), join(resourcesRoot, entry))
	}
}

/** New tree is healthy: drop the marker and the (now empty) staging dir. */
export function commitSwap(options: { readonly resourcesRoot: string }): void {
	rmSync(swapMarkerPath(options.resourcesRoot), { force: true })
	rmStagingDirs(options.resourcesRoot)
}

/**
 * The new tree never reached health (or a mid-swap crash left partial
 * moves): restore whatever the backup holds and leave un-touched
 * entries alone — the marker/backup pairs make every partial state
 * decidable without deleting an entry the swap never moved.
 */
export function rollbackSwap(options: {
	readonly resourcesRoot: string
}): void {
	const { resourcesRoot } = options
	for (const entry of SWAP_ENTRIES) {
		const backup = join(backupPath(resourcesRoot), entry)
		if (!existsSync(backup)) continue // never moved (or already restored)
		rmSync(join(resourcesRoot, entry), { recursive: true, force: true })
		renameRetry(backup, join(resourcesRoot, entry))
	}
	rmStagingDirs(resourcesRoot)
	rmSync(swapMarkerPath(resourcesRoot), { force: true })
	rmSync(backupPath(resourcesRoot), { recursive: true, force: true })
}

/** Drop the previous tree once the soak window passed without a crash. */
export function deleteBackup(options: {
	readonly resourcesRoot: string
}): void {
	rmSync(backupPath(options.resourcesRoot), { recursive: true, force: true })
}

/**
 * Idempotent boot recovery:
 * - marker + backup      → crash mid-swap → roll back to the old tree;
 * - marker, no backup    → swap completed, crash before commit → finish
 *   the commit (drop marker + staging);
 * - backup, no marker    → crash after commit, before cleanup → cleanup;
 * - nothing              → no-op.
 */
export function recoverAtBoot(resourcesRoot: string): RecoveryAction {
	const marker = existsSync(swapMarkerPath(resourcesRoot))
	const backup =
		existsSync(backupPath(resourcesRoot)) &&
		readdirSync(backupPath(resourcesRoot)).some((name) =>
			(SWAP_ENTRIES as readonly string[]).includes(name),
		)
	if (marker && backup) {
		rollbackSwap({ resourcesRoot })
		return "rolled-back"
	}
	if (marker && !backup) {
		commitSwap({ resourcesRoot })
		return "committed"
	}
	if (!marker && backup) {
		rmSync(backupPath(resourcesRoot), { recursive: true, force: true })
		return "committed"
	}
	rmStagingDirs(resourcesRoot)
	return "none"
}

function writeMarker(
	resourcesRoot: string,
	version: string,
	stagingRoot: string,
): void {
	writeFileSync(
		swapMarkerPath(resourcesRoot),
		`${JSON.stringify(
			{ schema: 1, version, staging: basename(stagingRoot) },
			null,
			"\t",
		)}\n`,
		"utf8",
	)
}

function renameRetry(src: string, dest: string): void {
	let lastError: unknown
	for (let attempt = 1; attempt <= RENAME_RETRIES; attempt++) {
		try {
			renameSync(src, dest)
			return
		} catch (err) {
			lastError = err
			if (attempt < RENAME_RETRIES) {
				sleepSync(RENAME_RETRY_DELAY_MS * attempt)
			}
		}
	}
	throw new Error(
		`resource swap rename failed (${basename(src)} → ${basename(dest)}): ${String(lastError)}`,
	)
}

function rmStagingDirs(resourcesRoot: string): void {
	for (const name of readdirSync(resourcesRoot)) {
		if (name.startsWith(".staging-")) {
			rmSync(join(resourcesRoot, name), { recursive: true, force: true })
		}
	}
}

function dirSize(dir: string): number {
	if (!existsSync(dir)) return 0
	let total = 0
	const stack = [dir]
	while (stack.length > 0) {
		const current = stack.pop()
		if (current === undefined) continue
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name)
			if (entry.isDirectory()) stack.push(full)
			else {
				try {
					total += statSync(full).size
				} catch {
					// vanished meanwhile; treat as zero
				}
			}
		}
	}
	return total
}

function freeBytes(dir: string): number {
	const stats = statfsSync(dir)
	return stats.bavail * stats.bsize
}

function backupPath(resourcesRoot: string): string {
	return swapBackupRoot(resourcesRoot)
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}
