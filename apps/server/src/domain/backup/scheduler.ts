import { type ClockDeps, resolveClock } from "src/infra/service.ts"
import type { BackupService } from "./service.ts"

export type AutoSnapshotScheduler = {
	/**
	 * Arm the daily snapshot loop: take a catch-up snapshot immediately when
	 * the newest automatic snapshot is older than a day (covers hosts that
	 * sleep or stay offline between runs), then schedule the next fire at
	 * the following local midnight. Safe to call once per lifecycle.
	 */
	start(): Promise<void>
	/** Cancel the pending daily timer. Safe to call when never started. */
	stop(): void
}

export type AutoSnapshotSchedulerDeps = ClockDeps & {
	readonly service: BackupService
	/** Size of the rolling window: how many days of snapshots to keep. */
	readonly keep: number
	/**
	 * The server refuses to write while viewing a past archive; snapshot
	 * runs are skipped while this returns true.
	 */
	readonly isReadOnly: () => boolean
	/**
	 * Optional free-space probe (e.g. `fs.statfs` on the storage root).
	 * When it resolves below `minFreeBytes`, the run is skipped.
	 */
	readonly readFreeBytes?: () => Promise<number | undefined>
	/** Skip threshold for {@link AutoSnapshotSchedulerDeps.readFreeBytes}. */
	readonly minFreeBytes?: number
	/** Optional error sink (e.g. `app.log.error`). */
	readonly onError?: (err: unknown) => void
	/** Optional sink for skipped runs (e.g. `app.log.warn`). */
	readonly onSkip?: (reason: "low_disk") => void
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export type RefreshAutoSnapshotDeps = {
	readonly service: BackupService
	readonly keep: number
	readonly isReadOnly: () => boolean
	readonly readFreeBytes?: () => Promise<number | undefined>
	readonly minFreeBytes?: number
	readonly onError?: (err: unknown) => void
	readonly onSkip?: (reason: "low_disk") => void
}

/**
 * Take an automatic snapshot now (subject to the read-only and free-space
 * guards) and roll the retention window. Shared by the daily loop, the
 * boot catch-up, and the post-archive catch-up so every run path applies
 * the exact same guards.
 */
export async function refreshAutoSnapshot(
	deps: RefreshAutoSnapshotDeps,
): Promise<void> {
	const {
		service,
		keep,
		isReadOnly,
		readFreeBytes,
		minFreeBytes,
		onError,
		onSkip,
	} = deps
	if (isReadOnly()) return
	if (readFreeBytes !== undefined && minFreeBytes !== undefined) {
		const free = await readFreeBytes()
		if (free !== undefined && free < minFreeBytes) {
			onSkip?.("low_disk")
			return
		}
	}
	try {
		await service.createAuto()
		await service.pruneAuto(keep)
	} catch (err) {
		onError?.(err)
	}
}

/**
 * Build the automatic daily snapshot scheduler. Timekeeping is local-time
 * based (a single-user self-hosted app schedules against its own clock);
 * the next-midnight delay is recomputed after every fire so DST shifts
 * and clock drift self-correct.
 */
export function createAutoSnapshotScheduler(
	deps: AutoSnapshotSchedulerDeps,
): AutoSnapshotScheduler {
	const { service, keep, isReadOnly, onError } = deps
	const { now } = resolveClock(deps)
	let timer: ReturnType<typeof setTimeout> | undefined
	let started = false

	function runOnce(): void {
		void refreshAutoSnapshot({
			service,
			keep,
			isReadOnly,
			readFreeBytes: deps.readFreeBytes,
			minFreeBytes: deps.minFreeBytes,
			onError,
			onSkip: deps.onSkip,
		})
	}

	function scheduleNext(): void {
		if (timer !== undefined) return
		const delay = msUntilNextLocalMidnight(now())
		timer = setTimeout(() => {
			timer = undefined
			runOnce()
			scheduleNext()
		}, delay)
	}

	return {
		async start() {
			if (started) return
			started = true
			const newest = await newestAutoSnapshot()
			if (newest === undefined || now() - newest > ONE_DAY_MS) {
				await refreshAutoSnapshot({
					service,
					keep,
					isReadOnly,
					readFreeBytes: deps.readFreeBytes,
					minFreeBytes: deps.minFreeBytes,
					onError,
					onSkip: deps.onSkip,
				})
			}
			scheduleNext()
		},
		stop() {
			if (timer === undefined) return
			clearTimeout(timer)
			timer = undefined
		},
	}

	/**
	 * Creation time of the newest automatic snapshot across every version,
	 * or `undefined` when none exist yet.
	 */
	async function newestAutoSnapshot(): Promise<number | undefined> {
		const backups = await service.list()
		return backups.reduce<number | undefined>((newest, backup) => {
			if (backup.kind !== "auto") return newest
			return newest === undefined || backup.createdAt > newest
				? backup.createdAt
				: newest
		}, undefined)
	}
}

function msUntilNextLocalMidnight(ts: number): number {
	const next = new Date(ts)
	next.setHours(24, 0, 0, 0)
	return Math.max(1, next.getTime() - ts)
}
