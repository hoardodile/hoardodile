import type { Danmaku, Message } from "@hoardodile/sdk-types"

/**
 * In-memory stores backing the offline mock host's message and danmaku
 * handlers. Rows are shaped like the server's responses so plugin UI
 * tests exercise the real consumption paths.
 */

let nextId = 1

function generateId(prefix: string): string {
	return `${prefix}-${nextId++}`
}

export type MockMessageStore = {
	readonly list: (resId: string) => readonly Message[]
	readonly create: (
		resId: string,
		input: { body: string; anchor?: unknown },
	) => Message
}

/**
 * `seed` pre-fills the store with rows the plugin should already see —
 * the workbench passes the resource's real comments so the iframe opens
 * with the same content the app would show.
 */
export function createMockMessageStore(
	seed: readonly Message[] = [],
): MockMessageStore {
	const rows: Message[] = [...seed]
	return {
		list(resId) {
			return rows.filter((m) => m.resIds.includes(resId))
		},
		create(resId, input) {
			const message: Message = {
				id: generateId("msg"),
				body: input.body,
				createdAt: Date.now(),
				charIds: [],
				resIds: [resId],
				likeCount: 0,
				dislikeCount: 0,
				replyCount: 0,
				anchor: input.anchor as Message["anchor"],
			}
			rows.push(message)
			return message
		},
	}
}

export type MockDanmakuStore = {
	readonly list: (resId: string) => readonly Danmaku[]
	readonly create: (
		resId: string,
		input: { text: string; anchor: unknown; mode?: string },
	) => Danmaku
}

/** See {@link createMockMessageStore} for `seed`. */
export function createMockDanmakuStore(
	seed: readonly Danmaku[] = [],
): MockDanmakuStore {
	const rows: Danmaku[] = [...seed]
	return {
		list(resId) {
			return rows.filter((d) => d.anchor.resId === resId)
		},
		create(resId, input) {
			const danmaku: Danmaku = {
				id: generateId("dm"),
				anchor: { resId, data: (input.anchor as { data?: unknown }).data },
				text: input.text,
				color: "#fff",
				mode:
					input.mode === "scroll" ||
					input.mode === "top" ||
					input.mode === "bottom"
						? input.mode
						: "scroll",
				createdAt: Date.now(),
			}
			rows.push(danmaku)
			return danmaku
		},
	}
}
