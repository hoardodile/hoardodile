import type { CoverKindUi } from "@hoardodile/sdk-types"
import type { HookSnapshot, WorkbenchManifest } from "./context.ts"

/**
 * Pure pieces of the workbench's simulated res card, split out of the
 * `ResCardPreview` component so they can be tested in the workbench's
 * node Vitest environment (no jsdom).
 */

const COVER_KINDS = new Set(["image", "video", "audio"])

/**
 * Pick the manifest card block kind for a resource. The dev pipeline
 * sniffs the cover source and reports `snapshot.coverKind` (the host app
 * selects `ui.card.<kind>` from the comparable `coverMeta.kind`); a
 * plugin may also declare it in `sourceMeta.coverKind`. Everything else
 * falls back to `"default"`.
 */
export function resolveCoverKind(snapshot: HookSnapshot | null): string {
	const fromSnapshot = snapshot?.coverKind
	if (fromSnapshot !== undefined && COVER_KINDS.has(fromSnapshot)) {
		return fromSnapshot
	}
	const sourceMeta = snapshot?.sourceMeta
	if (typeof sourceMeta === "object" && sourceMeta !== null) {
		const kind = (sourceMeta as { coverKind?: unknown }).coverKind
		if (typeof kind === "string" && COVER_KINDS.has(kind)) return kind
	}
	return "default"
}

/**
 * The manifest `ui.card` corner-slot block for a given cover kind. The
 * kind-specific block wins when declared; otherwise the `default` block is
 * used — mirroring the app's slot selection, so a plugin that declares only
 * `default` (e.g. PDF, File) keeps its badges when a pinned cover turns
 * the resource's kind into `image`.
 */
export function pickCardSlotUi(
	manifest: WorkbenchManifest,
	coverKind: string,
): CoverKindUi | undefined {
	const card = manifest.ui?.card
	if (card === undefined) return undefined
	return card[coverKind as keyof typeof card] ?? card.default
}

/**
 * Resolve a manifest-relative `asset('path')` to the workbench `/data`
 * mount. Each path segment is encoded (so subdirectory separators stay
 * literal) and the resource id is fully encoded, matching how the app's
 * asset URLs keep relative paths intact.
 */
export function buildResCardAssetUrl(resId: string, path: string): string {
	const encodedPath = path.split("/").map(encodeURIComponent).join("/")
	return `/data/${encodedPath}?res=${encodeURIComponent(resId)}`
}

/**
 * Read the cover's pixel dimensions from the plugin's `sourceMeta`
 * (`width`/`height`) so the preview card can fit the cover to its own
 * aspect ratio instead of cropping it into a square. Returns `undefined`
 * when either dimension is missing or non-finite.
 */
export function readSourceMetaDims(
	snapshot: HookSnapshot | null,
): { readonly width: number; readonly height: number } | undefined {
	const sourceMeta = snapshot?.sourceMeta
	if (typeof sourceMeta !== "object" || sourceMeta === null) return undefined
	const { width, height } = sourceMeta as { width?: unknown; height?: unknown }
	if (
		typeof width === "number" &&
		Number.isFinite(width) &&
		width > 0 &&
		typeof height === "number" &&
		Number.isFinite(height) &&
		height > 0
	) {
		return { width, height }
	}
	return undefined
}

/**
 * Fabricated app-level metadata for the simulated res card. The dev
 * snapshot has the plugin's cover/dims/badges but no tag or character
 * data, so the preview fills those with plausible mock values so the card
 * reads like a real in-app resource. Purely presentational — no lookups.
 */
export type MockCardMeta = {
	readonly tags: readonly { readonly name: string; readonly color: string }[]
	readonly collections: readonly {
		readonly name: string
		readonly color: string
	}[]
	readonly sourceName: string
	readonly sourceUrl: string
	readonly sizeBytes: number
	readonly createdAt: number
}

export function buildMockCardMeta(): MockCardMeta {
	return {
		tags: [
			{ name: "photo", color: "#3b82f6" },
			{ name: "import", color: "#10b981" },
			{ name: "red", color: "#ef4444" },
		],
		collections: [{ name: "旅行", color: "#a855f7" }],
		sourceName: "example.com",
		sourceUrl: "https://example.com",
		sizeBytes: 4_700_000,
		createdAt: Date.now() - 2 * 86_400_000,
	}
}

/** Format a mock timestamp as a locale-aware date + time (no dayjs). */
export function formatMockDate(ts: number, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(ts))
}
