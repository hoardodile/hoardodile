import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import type { ResourceChannelHandle } from "./resource-updater.ts"
import type { FullUpdaterHandle } from "./updater.ts"

/**
 * Owns the update state machine, the polling cadence and the switch
 * between the two channels:
 * - the resource channel is the primary probe (Windows NSIS installs);
 *   it returns `"full"` when the release changed the shell/Electron, and
 * - the full channel (electron-updater) runs only for that verdict or on
 *   install shapes without the resource channel.
 *
 * Channels never touch the timers or the state; every emission funnels
 * through `notify`, so `status()` is always the last real state.
 */

const BOOT_DELAY_MS = 15_000
const INTERVAL_MS = 24 * 60 * 60 * 1000

export type UpdateManagerHandle = {
	readonly status: () => DesktopUpdateState
	/** Run one update check now (`manual` = the user clicked check). */
	readonly check: (manual?: boolean) => Promise<void>
	/** Apply the ready resource update (no-op when it is not ready). */
	readonly apply: () => Promise<void>
	/** Install the ready full update and restart the app. */
	readonly quitAndInstall: () => void
	readonly setEnabled: (enabled: boolean) => void
	readonly dispose: () => void
	/** Internal funnel channels emit through — keep the name stable. */
	readonly notify: (state: DesktopUpdateState) => void
}

export function startUpdateManager(options: {
	readonly enabled: boolean
	readonly dev: boolean
	readonly full: FullUpdaterHandle
	readonly resource: ResourceChannelHandle | undefined
	readonly onState: (state: DesktopUpdateState) => void
}): UpdateManagerHandle {
	const { dev, full, resource, onState } = options
	let enabled = options.enabled
	let state: DesktopUpdateState = { status: "idle" }
	let busy = false

	function handleState(next: DesktopUpdateState): void {
		state = next
		onState(next)
	}

	full.setEnabled(enabled)
	resource?.setEnabled(enabled)

	function scheduleBackgroundChecks(): void {
		clearTimers()
		if (!enabled || dev) return
		timers.push(
			setTimeout(() => {
				void check().catch(() => undefined)
			}, BOOT_DELAY_MS),
		)
		timers.push(
			setInterval(() => {
				void check().catch(() => undefined)
			}, INTERVAL_MS),
		)
	}

	async function check(manual = false): Promise<void> {
		// Single in-flight check; a ready/downloading/applying state is
		// its own answer — never downgrade a ready update to "latest" by
		// re-checking while it sits.
		if (
			busy ||
			state.status === "applying" ||
			state.status === "downloading" ||
			state.status === "ready"
		) {
			return
		}
		busy = true
		try {
			if (resource !== undefined) {
				handleState({ status: "checking", channel: "resources" })
				const verdict = await resource.check(manual)
				if (verdict === "full") {
					handleState({ status: "checking", channel: "full" })
					await full.check()
				}
				return
			}
			handleState({ status: "checking", channel: "full" })
			await full.check()
		} finally {
			busy = false
		}
	}

	function quitAndInstall(): void {
		if (state.status !== "ready" || state.channel !== "full") return
		full.quitAndInstall()
	}

	const timers: NodeJS.Timeout[] = []

	function clearTimers(): void {
		for (const timer of timers) clearTimeout(timer)
		timers.length = 0
	}

	scheduleBackgroundChecks()

	return {
		status: () => state,
		check,
		async apply() {
			if (state.status === "ready" && state.channel === "resources") {
				await resource?.apply()
			}
		},
		quitAndInstall,
		setEnabled(next) {
			enabled = next
			full.setEnabled(next)
			resource?.setEnabled(next)
			scheduleBackgroundChecks()
		},
		dispose() {
			clearTimers()
			full.dispose()
			resource?.dispose()
		},
		notify: handleState,
	}
}
