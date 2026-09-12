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
 * probes the cover source and reports `snapshot.coverKind` (the host app
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
 * The app resource card's cover window, mirroring `ResCard`'s
 * `MIN/MAX_WIDTH/HEIGHT_PX` bounds. A preview sized by these rules
 * reserves exactly the box the grid would give this resource.
 */
const CARD_MIN_WIDTH_PX = 200
const CARD_MAX_WIDTH_PX = 400
const CARD_MAX_HEIGHT_PX = 600

export type CoverBox = {
	readonly width: number
	readonly height: number
}

/**
 * The cover dimensions the dev server probed for this resource — the
 * workbench's stand-in for the app's `coverMeta`, which the server fills
 * by probing the same cover source. Returns `undefined` when the probe
 * had no box (a non-media cover, a failed probe, artwork-less audio) —
 * exactly when the app's card falls back to its compact square floor.
 */
export function readCoverDims(
	snapshot: HookSnapshot | null,
): CoverBox | undefined {
	const { coverWidth: width, coverHeight: height } = snapshot ?? {}
	if (!isPixelCount(width) || !isPixelCount(height)) return undefined
	return { width, height }
}

/**
 * The box the card reserves for its cover: the probed dimensions scaled
 * down to fit the card's window, aspect kept, never scaled up — the
 * app's `buildIntrinsicStyle` intrinsic branch. Without a probe box the
 * tile falls back to the compact square the app uses for a cover it
 * cannot size.
 */
export function fitCoverBox(dims: CoverBox | undefined): CoverBox {
	if (dims === undefined) {
		return { width: CARD_MIN_WIDTH_PX, height: CARD_MIN_WIDTH_PX }
	}
	const scale = Math.min(
		CARD_MAX_WIDTH_PX / dims.width,
		CARD_MAX_HEIGHT_PX / dims.height,
		1,
	)
	return {
		width: Math.round(dims.width * scale),
		height: Math.round(dims.height * scale),
	}
}

/**
 * The card's own width: the cover box, floored at the compact width so a
 * tiny cover still has room for the name — the app clamps the card to
 * `MIN_WIDTH_PX`/`MAX_WIDTH_PX` around the tile it centers.
 */
export function cardWidth(box: CoverBox): number {
	return Math.max(CARD_MIN_WIDTH_PX, box.width)
}

function isPixelCount(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
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
