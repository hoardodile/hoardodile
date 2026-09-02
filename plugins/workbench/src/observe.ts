import type { MockDanmakuStore, MockMessageStore } from "@hoardodile/host-web"
import type { Danmaku, Message } from "@hoardodile/sdk-types"

/**
 * Observer wrappers over the mock message/danmaku stores. The workbench
 * records every row a plugin creates so it survives a refresh, but the
 * stores themselves only expose `list`/`create` — these thin wrappers let
 * the workbench observe a `create` without touching the published
 * `@hoardodile/host-web` package. `list` and the rest pass through
 * untouched.
 */

/** Create how a plugin-created message is reported. */
export type MessageCreated = (resId: string, message: Message) => void
/** How a plugin-created danmaku is reported. */
export type DanmakuCreated = (resId: string, danmaku: Danmaku) => void

export function observeMessages(
	store: MockMessageStore,
	onCreated: MessageCreated,
): MockMessageStore {
	return {
		...store,
		create: (resId, input) => {
			const message = store.create(resId, input)
			onCreated(resId, message)
			return message
		},
	}
}

export function observeDanmaku(
	store: MockDanmakuStore,
	onCreated: DanmakuCreated,
): MockDanmakuStore {
	return {
		...store,
		create: (resId, input) => {
			const danmaku = store.create(resId, input)
			onCreated(resId, danmaku)
			return danmaku
		},
	}
}
