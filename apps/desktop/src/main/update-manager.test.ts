/**
 * @vitest-environment node
 *
 * The update manager is the composition root: both channels are mocked,
 * states are injected through `notify` (the seam real channels use), and
 * the assertions cover orchestration + gating + the polling cadence.
 */

import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ResourceChannelHandle } from "./resource-updater.ts"
import {
	startUpdateManager,
	type UpdateManagerHandle,
} from "./update-manager.ts"
import type { FullUpdaterHandle } from "./updater.ts"

type Channels = {
	readonly full: FullUpdaterHandle & {
		check: ReturnType<typeof vi.fn>
		quitAndInstall: ReturnType<typeof vi.fn>
		setEnabled: ReturnType<typeof vi.fn>
		dispose: ReturnType<typeof vi.fn>
	}
	readonly resource:
		| (ResourceChannelHandle & {
				check: ReturnType<typeof vi.fn>
				apply: ReturnType<typeof vi.fn>
				setEnabled: ReturnType<typeof vi.fn>
				dispose: ReturnType<typeof vi.fn>
		  })
		| undefined
}

function makeChannels(verdict: "none" | "full" = "none"): Channels {
	return {
		full: {
			check: vi.fn(async () => {}),
			quitAndInstall: vi.fn(),
			setEnabled: vi.fn(),
			dispose: vi.fn(),
		} as unknown as Channels["full"],
		resource: {
			check: vi.fn(async () => verdict),
			apply: vi.fn(async () => {}),
			setEnabled: vi.fn(),
			dispose: vi.fn(),
		} as unknown as NonNullable<Channels["resource"]>,
	}
}

function makeManager(
	channels: Channels,
	options: { dev?: boolean; enabled?: boolean } = {},
): {
	readonly manager: UpdateManagerHandle
	readonly emitted: DesktopUpdateState[]
} {
	const emitted: DesktopUpdateState[] = []
	const manager = startUpdateManager({
		enabled: options.enabled ?? true,
		dev: options.dev ?? false,
		full: channels.full as unknown as FullUpdaterHandle,
		resource: channels.resource as unknown as ResourceChannelHandle,
		onState: (state) => emitted.push(state),
	})
	return { manager, emitted }
}

afterEach(() => {
	vi.useRealTimers()
})

describe("update manager orchestration", () => {
	it("runs the resource check and skips the full channel on a resource verdict", async () => {
		const channels = makeChannels("none")
		const { manager } = makeManager(channels)
		await manager.check()
		expect(channels.resource?.check).toHaveBeenCalledTimes(1)
		expect(channels.full.check).not.toHaveBeenCalled()
	})

	it("falls through to the full channel when the resource verdict is full", async () => {
		const channels = makeChannels("full")
		const { manager, emitted } = makeManager(channels)
		await manager.check()
		expect(channels.resource?.check).toHaveBeenCalledTimes(1)
		expect(channels.full.check).toHaveBeenCalledTimes(1)
		expect(emitted).toContainEqual({
			status: "checking",
			channel: "full",
		})
	})

	it("passes the manual flag through to the resource channel", async () => {
		const channels = makeChannels("none")
		const { manager } = makeManager(channels)
		await manager.check(true)
		expect(channels.resource?.check).toHaveBeenCalledWith(true)
		await manager.check(false)
		expect(channels.resource?.check).toHaveBeenLastCalledWith(false)
	})

	it("no-ops while a check is in flight or an update is pending", async () => {
		const channels = makeChannels("none")
		const { manager } = makeManager(channels)
		// A pending download/ready state (injected like a real channel would).
		manager.notify({ status: "downloading", channel: "resources", percent: 10 })
		await manager.check()
		manager.notify({ status: "ready", channel: "resources", version: "1.0.0" })
		await manager.check()
		manager.notify({
			status: "applying",
			channel: "resources",
			phase: "stopping",
		})
		await manager.check()
		expect(channels.resource?.check).not.toHaveBeenCalled()

		// Back to idle: checks flow again.
		manager.notify({ status: "idle" })
		await manager.check()
		expect(channels.resource?.check).toHaveBeenCalledTimes(1)
	})

	it("applies only a ready resource update", async () => {
		const channels = makeChannels("none")
		const { manager } = makeManager(channels)

		manager.notify({ status: "ready", channel: "full", version: "1.0.0" })
		await manager.apply()
		expect(channels.resource?.apply).not.toHaveBeenCalled()

		manager.notify({ status: "ready", channel: "resources", version: "1.0.0" })
		await manager.apply()
		expect(channels.resource?.apply).toHaveBeenCalledTimes(1)
	})

	it("installs only a ready full update", async () => {
		const channels = makeChannels("full")
		const { manager } = makeManager(channels)

		manager.notify({ status: "ready", channel: "resources", version: "1.0.0" })
		manager.quitAndInstall()
		expect(channels.full.quitAndInstall).not.toHaveBeenCalled()

		manager.notify({ status: "ready", channel: "full", version: "1.0.0" })
		manager.quitAndInstall()
		expect(channels.full.quitAndInstall).toHaveBeenCalledTimes(1)
	})

	it("forwards enablement to both channels", async () => {
		const channels = makeChannels("none")
		const { manager } = makeManager(channels)
		manager.setEnabled(false)
		expect(channels.full.setEnabled).toHaveBeenLastCalledWith(false)
		expect(channels.resource?.setEnabled).toHaveBeenLastCalledWith(false)
		manager.setEnabled(true)
		expect(channels.full.setEnabled).toHaveBeenLastCalledWith(true)
		expect(channels.resource?.setEnabled).toHaveBeenLastCalledWith(true)
	})
})

describe("update manager cadence", () => {
	it("runs a boot check after 15 s and then a daily check", async () => {
		vi.useFakeTimers()
		const channels = makeChannels("none")
		const { manager } = makeManager(channels)

		await vi.advanceTimersByTimeAsync(15_000)
		expect(channels.resource?.check).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
		expect(channels.resource?.check).toHaveBeenCalledTimes(2)
		expect(channels.full.check).not.toHaveBeenCalled()

		manager.dispose()
	})

	it("never schedules in dev runs", async () => {
		vi.useFakeTimers()
		const channels = makeChannels("none")
		const { manager } = makeManager(channels, { dev: true })

		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 15_000)
		expect(channels.resource?.check).not.toHaveBeenCalled()
		expect(channels.full.check).not.toHaveBeenCalled()

		// Manual checks still work in dev (they no-op in the channels).
		await manager.check(true)
		expect(channels.resource?.check).toHaveBeenCalledTimes(1)

		manager.dispose()
	})

	it("stops scheduling when disabled and resumes on enable", async () => {
		vi.useFakeTimers()
		const channels = makeChannels("none")
		const { manager } = makeManager(channels, { enabled: false })
		await vi.advanceTimersByTimeAsync(15_000)
		expect(channels.resource?.check).not.toHaveBeenCalled()

		manager.setEnabled(true)
		await vi.advanceTimersByTimeAsync(15_000)
		expect(channels.resource?.check).toHaveBeenCalledTimes(1)

		manager.setEnabled(false)
		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
		expect(channels.resource?.check).toHaveBeenCalledTimes(1)

		manager.dispose()
	})
})
