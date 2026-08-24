/**
 * @hoardodile/sdk-types — the plugin contract: manifest schema, the
 * plugin definition contract (`PluginDefinition`/`ResourceAPI`/
 * `definePlugin`/fixtures), and the shared message/danmaku/anchor wire
 * shapes. Single source of truth consumed by every SDK package, the
 * host, and the app; nothing here touches the DOM or node.
 *
 * This package is the contract — plugins normally import it for types
 * (`PluginSchema`, `PluginManifest`, ...) and (via
 * `@hoardodile/sdk-server`) the `definePlugin` factory. The zod
 * runtime validators (`pluginManifest`, `anchorData`) live behind the
 * `@hoardodile/sdk-types/schema` subpath so plugin bundles never pull
 * zod.
 *
 * Plugin-facing constants (data, plus the pure lookups that read it)
 * live in subpaths mirroring their source files — there is no root
 * export for them:
 *
 * - `@hoardodile/sdk-types/image-variant` — derived-image variant
 *   contract: spec types, query parsing/encoding, canonical cache
 *   identity
 * - `@hoardodile/sdk-types/media-exts` — media-type tables: extension
 *   sets, extension ↔ MIME, MIME ↔ media kind
 * - `@hoardodile/sdk-types/plugin` — plugin runtime limits (read cap,
 *   probe/stat fan-out bounds)
 * - `@hoardodile/sdk-types/resource` — resource caps (search-meta version,
 *   preview eligibility)
 * - `@hoardodile/sdk-types/template` — the host cover/message template
 *   grammar (fragment splitter, tokeniser, parser — shared with the
 *   web renderer and the CLI's build-time lint)
 * - `@hoardodile/sdk-types/text-limits` — plugin input limits (danmaku
 *   body, comment body)
 *
 * App-only constants live in `@hoardodile/shared` (infra limits) and
 * `@hoardodile/schemas` (field lengths) instead.
 */
export * from "./file-list.ts"
export type {
	CoverKindUi,
	CoverKindUiMap,
	PluginManifest,
	PluginManifestId,
	PluginManifestUi,
	PluginPermissions,
	SearchKind,
} from "./manifest.ts"
export * from "./plugin-asset.ts"
export * from "./plugin-definition.ts"
export * from "./read-range.ts"
export * from "./result.ts"
export type { AnchorData } from "./schema.ts"

/** Web plugin danmaku mode. */
export type DanmakuMode = "scroll" | "top" | "bottom"

/**
 * Client-side danmaku list filter: every entry is matched by strict
 * equality against the same key in the danmaku's anchor `data`. Keys are
 * plugin-defined vocabulary (e.g. `{ kind: "videoTime", filename }` in
 * an official content plugin) — the SDK only defines the matching semantics,
 * not which keys exist.
 */
export type DanmakuListFilter = Readonly<
	Record<string, string | number | boolean>
>

/**
 * Anchor as returned in `Message` / `Danmaku` API shapes: the resource
 * the anchor points into plus the plugin location payload. The server
 * derives `resId` from the row's own `anchor_resource_id` column —
 * plugin code never supplies it (see `anchorData` in
 * `@hoardodile/sdk-types/schema`).
 */
export type ResAnchor = {
	readonly resId: string
	readonly data?: unknown
}

/** Web plugin message shape. */
export type Message = {
	readonly id: string
	readonly parentId?: string
	readonly body: string
	readonly createdAt: number
	readonly deletedAt?: number
	readonly charIds: readonly string[]
	readonly resIds: readonly string[]
	readonly likeCount: number
	readonly dislikeCount: number
	readonly replyCount: number
	readonly floor?: number
	readonly anchor?: ResAnchor
}

/** Web plugin danmaku shape. */
export type Danmaku = {
	readonly id: string
	readonly anchor: ResAnchor
	readonly text: string
	readonly color: string
	readonly mode: DanmakuMode
	readonly createdAt: number
}

/** Plugin-facing file stats slice of a resource. */
export type FileStats = {
	readonly sizeBytes?: number
	readonly count?: number
}

/** Plugin-produced search metadata. The host enforces its own schema at ingestion time. */
export type SearchMeta = {
	readonly v: number
	readonly facets?: Readonly<Record<string, boolean>>
}
