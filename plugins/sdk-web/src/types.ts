import type {
	AnchorData,
	Danmaku,
	DanmakuListFilter,
	DanmakuMode,
	FileStats,
	Message,
	PluginSchema,
} from "@hoardodile/sdk-types"
import type { ImageVariantSpec } from "@hoardodile/sdk-types/image-variant"
import type {
	InvalidateTarget,
	PluginFonts,
	ReadFileRange,
} from "./protocol.ts"

/**
 * What {@link WebPluginAPI.resolveFileUrl} may address: the original
 * bytes (`"original"`, or omit the argument), the default preview
 * variant (`"preview"`), or a custom derived image via
 * {@link ImageVariantSpec}.
 */
export type FileUrlVariant = "original" | "preview" | ImageVariantSpec

/**
 * The current resource as seen by the plugin iframe: id/name plus the
 * schema-typed metadata (`sourceMeta`, `searchMeta`, `fileStats`) that
 * the host derived at import time. Injected via the iframe context; the
 * reactive hooks derive from it, so render code reads the live value
 * from `usePluginAPI().resource`.
 */
export type PluginResource<TSchema extends PluginSchema = PluginSchema> = {
	readonly id: string
	readonly name: string
	readonly sourceMeta: TSchema["sourceMeta"]
	readonly searchMeta: TSchema["searchMeta"]
	readonly fileStats: FileStats | undefined
	readonly contentPluginId: string
}

/** Encode/decode pair for typed preference values. */
export type Codec<T> = {
	readonly encode: (value: T) => string
	readonly decode: (raw: string) => T | undefined
}

/** Reactive query state returned by hooks. */
export type QueryState<T> = {
	readonly data: T | undefined
	readonly isLoading: boolean
	readonly isError: boolean
	readonly error: Error | null
}

/** Reactive mutation state returned by hooks. */
export type MutationState<TInput, TOutput> = {
	readonly mutate: (input: TInput) => Promise<TOutput>
	readonly isPending: boolean
}

/** Current theme as observed by the plugin. */
export type Theme = {
	readonly resolvedTheme: string
	readonly palette: string
	/** Icon rendering style (`duotone` | `grayscale` | `linear`). */
	readonly iconStyle: string
}

/**
 * Imperative, framework-agnostic API surface injected into plugin render
 * modules. Reactive hooks (see {@link ReactivePluginAPI}) are provided by
 * framework adapters — `@hoardodile/sdk-react` composes both into the
 * full API seen by React plugin components.
 */
export type WebPluginAPI<TSchema extends PluginSchema = PluginSchema> = {
	/** Logging */
	readonly logInfo: (message: string, data?: Record<string, unknown>) => void
	readonly logWarn: (message: string, data?: Record<string, unknown>) => void
	readonly logError: (message: string, data?: Record<string, unknown>) => void

	/** Resource context. */
	readonly resource: PluginResource<TSchema>

	/** Files. */
	readonly listFiles: () => Promise<readonly TSchema["file"][]>
	/**
	 * Read a file relative to the resource root. Without `range` the whole
	 * file is returned; large files should be read in bounded chunks via
	 * the byte range (mirrors the server-side `ResourceAPI.readFile`).
	 */
	readonly readFile: (
		path: string,
		range?: ReadFileRange,
	) => Promise<ArrayBuffer>
	/**
	 * Resolve a server-rendered URL for a file inside the resource.
	 * Without `variant` (or with `"original"`) the URL addresses the
	 * original bytes; `"preview"` selects the default preview variant
	 * (AVIF, fit inside the standard area cap); pass an
	 * {@link ImageVariantSpec} to request a custom derived image —
	 * e.g. `{ format: "webp", fit: "exact" }` transcodes to WebP at the
	 * source's exact pixel dimensions (no resize), and
	 * `{ maxArea: 2_000_000 }` caps a downscale. Variant renders are
	 * cached by the host; pick the `file.preview` flag to gate an
	 * original/preview toggle.
	 */
	readonly resolveFileUrl: (
		filename: string,
		variant?: FileUrlVariant,
	) => string
	/**
	 * Resolve the URL of a file materialized by the plugin's
	 * `extractArchive` hook: an inner entry of an archive (zip/tar)
	 * served from the host's extraction cache. `path` is the entry's
	 * relative path inside the archive, exactly as returned by
	 * `extractArchive` / the `listFiles` hook. Tokenized like
	 * `resolveFileUrl`.
	 */
	readonly resolveExtractedUrl: (path: string) => string
	/**
	 * Resolve the URL of the host's in-flight extraction progress for
	 * this resource (see `extractArchive`). Returns
	 * `{ done, total }` while materializing, `null` otherwise. Tokenized
	 * like `resolveFileUrl`; polls are cheap (no-store JSON).
	 */
	readonly extractProgressUrl: () => string
	/**
	 * Root URL of the current resource's files directory, trailing-slash
	 * included. For vendor SDKs that internally join relative paths and need
	 * a base.
	 */
	readonly resolveBaseUrl: () => string
	/**
	 * Resolve a server-rendered frame thumbnail URL for a video file at the
	 * given timestamp (in milliseconds, measured from the start of the
	 * file). The server decodes the requested frame on demand; callers
	 * should debounce frequent invocations (e.g. while scrubbing) to avoid
	 * a flood of decode requests.
	 */
	readonly resolveFrameUrl: (filename: string, timeMs: number) => string

	/** Messages. */
	readonly listMessages: () => Promise<readonly Message[]>
	readonly createMessage: (input: {
		readonly body: string
		/** Raw plugin location data (see {@link PluginSchema.anchor}). */
		readonly anchor?: TSchema["anchor"]
	}) => Promise<Message>

	/** Danmaku. */
	readonly listDanmaku: (
		filter?: DanmakuListFilter,
	) => Promise<readonly Danmaku[]>
	readonly createDanmaku: (input: {
		readonly text: string
		/** Raw plugin location data (see {@link PluginSchema.anchor}). */
		readonly anchor: TSchema["anchor"]
		readonly mode?: DanmakuMode
	}) => Promise<Danmaku>

	/** Preferences. */
	readonly getPref: (key: string) => string | undefined
	readonly setPref: (key: string, value: string) => void

	/** Cache. */
	readonly getCache: (key: string) => string | undefined
	readonly setCache: (key: string, value: string) => void
	readonly listCache: () => readonly {
		readonly key: string
		readonly value: string
	}[]

	/** Invalidation. */
	readonly invalidate: (target: InvalidateTarget) => Promise<void>

	/**
	 * Subscribe to host-initiated anchor jumps (e.g. the user clicked a
	 * comment anchor in the host UI). The callback receives the raw wire
	 * envelope ({@link AnchorData}) — decode `anchor.data` yourself, or
	 * use the typed `useAnchorJump` from `@hoardodile/sdk-react`, which
	 * decodes at the SDK boundary. Always targets the iframe's own
	 * resource. Returns an unsubscribe function.
	 */
	readonly onAnchorJump: (cb: (anchor: AnchorData) => void) => () => void
}

/**
 * Reactive (hook-based) API surface, implemented by framework adapters.
 * Plain `@hoardodile/sdk-web` consumers get the imperative
 * {@link WebPluginAPI} only; `@hoardodile/sdk-react` provides these via
 * `createPluginQueryAPI`.
 */
export type ReactivePluginAPI<TSchema extends PluginSchema = PluginSchema> = {
	readonly useFileList: () => QueryState<readonly TSchema["file"][]>
	readonly useMessageList: () => QueryState<readonly Message[]>
	readonly useCreateMessage: () => MutationState<
		{
			readonly body: string
			readonly anchor?: TSchema["anchor"]
		},
		Message
	>
	readonly useDanmakuList: (
		filter?: DanmakuListFilter,
	) => QueryState<readonly Danmaku[]>
	readonly useCreateDanmaku: () => MutationState<
		{
			readonly text: string
			readonly anchor: TSchema["anchor"]
			readonly mode?: DanmakuMode
		},
		Danmaku
	>
	readonly usePref: <T>(
		key: string,
		defaultValue: T,
		codec?: Codec<T>,
	) => readonly [T, (value: T) => void]
	readonly useTheme: () => Theme
	readonly useFont: () => PluginFonts
}
