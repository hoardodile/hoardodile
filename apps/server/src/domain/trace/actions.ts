/**
 * Discrete user actions recorded by the trace domain (the "footprint").
 *
 * Browsing exposure (what the user read and for how long) is NOT part of
 * this list — the usage domain owns that data via `usage_sessions`.
 * Events here are append-only rows in `user_actions`, snapshotting the
 * entity name so the footprint survives hard deletes.
 */
export const TRACE_ACTIONS = [
	"resource.import",
	"resource.export",
	"resource.softDelete",
	"resource.restore",
	"resource.hardDelete",
	"resource.dislike.add",
	"resource.dislike.cancel",
	"comment.create",
	"comment.softDelete",
	"comment.restore",
	"comment.hardDelete",
	"comment.vote.add",
	"comment.vote.cancel",
	"comment.vote.swap",
	"document.create",
	"document.commit",
	"document.softDelete",
	"document.restore",
	"document.hardDelete",
	"character.create",
	"character.softDelete",
	"character.restore",
	"character.hardDelete",
] as const

export type TraceAction = (typeof TRACE_ACTIONS)[number]

/**
 * The four entity groups trace actions live under (`entityType` in
 * `user_actions`) — the coarse categories the footprints timeline filters
 * by, never the fine-grained verbs each group folds.
 */
export const TRACE_ENTITY_TYPES = [
	"resource",
	"comment",
	"document",
	"character",
] as const

export type TraceEntityType = (typeof TRACE_ENTITY_TYPES)[number]

/** Extra per-action context stored on the event row. */
export type TraceActionDetail = {
	readonly bulk?: boolean
	readonly sourceName?: string | null
	readonly fileCount?: number
	readonly kind?: "like" | "dislike"
	readonly floor?: number
	readonly versionNo?: number
}

/**
 * Payload emitted by domain services via the `onUserAction` callback and
 * persisted by the trace service. Domain services stay agnostic of the
 * trace domain; wiring happens at the composition root (res/plugin.ts).
 */
export type UserAction = {
	readonly action: TraceAction
	readonly entityType: string
	readonly entityId: string
	readonly entityName: string
	readonly detail?: TraceActionDetail
}
