import type {
	Detection,
	FileType,
	ImageHashesResult,
	MediaKind,
	ResourceAPI,
} from "@hoardodile/sdk-server"
import { definePlugin } from "@hoardodile/sdk-server"
import {
	imageHashesForFile,
	mapConcurrent,
	mediaFileList,
	probeMediaFile,
} from "@hoardodile/sdk-server/helpers"
import {
	PLUGIN_ANIMATION_SCAN_BATCH,
	PLUGIN_AUDIO_COVER_SCAN_LIMIT,
	PLUGIN_IMAGE_PROBE_CONCURRENCY,
} from "@hoardodile/sdk-types/plugin"
import { SEARCH_META_VERSION } from "@hoardodile/sdk-types/resource"
import type {
	GalleryFile,
	GallerySchema,
	GallerySearchMeta,
	GallerySourceMeta,
} from "./shared"

const MEDIA_KINDS = new Set<MediaKind>(["image", "video", "audio"])

/**
 * Formats the host can decode but browsers cannot render natively:
 * originals would show up as broken `<img>` in most engines, so the
 * gallery always serves them through the sharp preview pipeline. The
 * "show original" toggle stays available for users who want the file
 * as archived.
 *
 * Keyed by the sniffed MIME type rather than the filename, so a
 * mislabelled or extension-less HEIC/TIFF still renders — the content
 * is the verdict, not the extension.
 */
const TRANSCODE_IMAGE_MIMES = new Set([
	"image/heic",
	"image/heif",
	"image/tiff",
])

export default definePlugin<GallerySchema>({
	detect,
	sourceMeta: buildSourceMetaGallery,
	searchMeta,
	coverLocal: buildLocalCover,
	listFiles: buildFileList,
	imageHashes: buildImageHashes,
})

/**
 * The gallery reads flat file sequences only: entries are recognised as
 * top-level files, and anything nested under a folder never joins the
 * gallery — folder-shaped resources belong to the chapter-style
 * plugins.
 */
async function flatFiles(api: ResourceAPI): Promise<readonly string[]> {
	const files = await api.listFileNames()
	return files.filter((name) => !name.includes("/"))
}

/** Sniffed file type per file, in the given order. */
async function classify(
	api: ResourceAPI,
	names: readonly string[],
): Promise<readonly (FileType | undefined)[]> {
	return mapConcurrent(names, PLUGIN_IMAGE_PROBE_CONCURRENCY, (name) =>
		api.sniff(name),
	)
}

/**
 * Media is decided by content, not by filename: an extension-less
 * export or a `.dat` scan is still a gallery. Only top-level files are
 * candidates — nested media does not make a resource a gallery.
 */
async function detect(api: ResourceAPI): Promise<Detection> {
	const files = await flatFiles(api)
	for (let i = 0; i < files.length; i += PLUGIN_IMAGE_PROBE_CONCURRENCY) {
		const batch = files.slice(i, i + PLUGIN_IMAGE_PROBE_CONCURRENCY)
		const types = await classify(api, batch)
		if (
			types.some((type) => type !== undefined && MEDIA_KINDS.has(type.kind))
		) {
			return { ok: true } as const
		}
	}
	return { ok: false, reasons: ["media-file"] }
}

/** Non-native image formats always render through the preview pipeline. */
function forceTranscodePreview(
	file: GalleryFile,
	type: FileType | undefined,
): GalleryFile {
	if (
		file.type === "image" &&
		type?.kind === "image" &&
		TRANSCODE_IMAGE_MIMES.has(type.mime)
	) {
		return { ...file, preview: true }
	}
	return file
}

type ProbedMediaFile = Awaited<ReturnType<typeof probeMediaFile>>

/**
 * Gallery entry for a probed file. The probe decides the final type (a
 * container the sniffer read as video may turn out to hold audio only);
 * the sniffed type still decides the transcode need — it is what the
 * bytes are.
 */
function toGalleryFile(
	filename: string,
	probed: ProbedMediaFile | undefined,
	type: FileType | undefined,
): GalleryFile | undefined {
	if (probed === undefined) return undefined
	return forceTranscodePreview({ filename, ...probed }, type)
}

async function buildSourceMetaGallery(
	resAPI: ResourceAPI,
): Promise<GallerySourceMeta | undefined> {
	// The container's canonical order (`.order` upload order, natural
	// name sort otherwise) decides the preview sequence, so the first
	// pages of a chapter-style resource are what the card shows.
	const files = await flatFiles(resAPI)

	const previews: GalleryFile[] = []
	for (const filename of files) {
		// The probe already sniffed internally, so this is a host-side
		// cache hit — the sniffed type is what decides transcode needs.
		const [type, probed] = await Promise.all([
			resAPI.sniff(filename),
			probeMediaFile(resAPI, filename),
		])
		const file = toGalleryFile(filename, probed, type)
		if (file === undefined) continue
		previews.push(file)
		if (previews.length >= 3) break
	}

	const cached = previews[0]
	let result: GallerySourceMeta | undefined
	if (cached) {
		if (cached.type === "audio") {
			// Audio carries no pixel dimensions; the duration is what the
			// card badge and the reader surface consume.
			result = { durationMs: cached.durationMs }
		} else if (cached.width !== undefined && cached.height !== undefined) {
			result = {
				width: cached.width,
				height: cached.height,
				durationMs: cached.durationMs,
			}
		}
	}

	if (result === undefined || previews.length === 0) return result
	return { ...result, previews }
}

async function searchMeta(
	api: ResourceAPI,
): Promise<GallerySearchMeta | undefined> {
	const files = await flatFiles(api)
	if (files.length === 0) return undefined
	const presence = {
		image: false,
		animation: false,
		video: false,
		audio: false,
	}
	// Batched fan-out: sniffing runs concurrently within a batch, and the
	// early-exit check between batches keeps the "all facets found" short
	// path. Only images escalate to a decode, and only until the first
	// animated one is found.
	for (let i = 0; i < files.length; i += PLUGIN_ANIMATION_SCAN_BATCH) {
		const batch = files.slice(i, i + PLUGIN_ANIMATION_SCAN_BATCH)
		const types = await classify(api, batch)
		await Promise.all(
			batch.map(async (filename, index) => {
				switch (types[index]?.kind) {
					case "image": {
						presence.image = true
						if (presence.animation) return
						const probed = await api.probe(filename)
						if (probed.kind === "image" && probed.animated) {
							presence.animation = true
						}
						return
					}
					case "video":
						presence.video = true
						return
					case "audio":
						presence.audio = true
						return
					default:
				}
			}),
		)
		if (
			presence.image &&
			presence.animation &&
			presence.video &&
			presence.audio
		)
			break
	}
	if (
		!presence.image &&
		!presence.video &&
		!presence.audio &&
		!presence.animation
	)
		return undefined
	return { v: SEARCH_META_VERSION, facets: presence }
}

/**
 * Pick the file the host renders the resource cover from. Images and
 * videos win outright — both yield a real frame. An audio-only resource
 * falls back to a track, preferring one with embedded artwork so the
 * host can extract it; without artwork the track is still returned, and
 * the card renders its audio player instead of a thumbnail.
 */
async function buildLocalCover(api: ResourceAPI): Promise<string | undefined> {
	// First file in canonical (`.order` upload) order — the first page
	// of a sequence is the natural cover.
	const files = await flatFiles(api)
	const types = await classify(api, files)
	const audioFiles: string[] = []
	for (const [index, filename] of files.entries()) {
		const kind = types[index]?.kind
		if (kind === "image" || kind === "video") return filename
		if (kind === "audio") audioFiles.push(filename)
	}
	if (audioFiles.length === 0) return undefined
	// Sequential with an early exit: albums repeat the same artwork on
	// every track, so this almost always stops after the first probe.
	for (const filename of audioFiles.slice(0, PLUGIN_AUDIO_COVER_SCAN_LIMIT)) {
		const probed = await api.probe(filename)
		if (probed.kind === "audio" && probed.coverArt !== undefined) {
			return filename
		}
	}
	return audioFiles[0]
}

async function buildFileList(
	api: ResourceAPI,
): Promise<readonly GalleryFile[]> {
	// Preserve the container's canonical order (`.order` upload order,
	// natural name sort as fallback) — re-sorting here would scramble
	// the user's chosen sequence.
	const files = await flatFiles(api)
	const entries = await mediaFileList(api, { names: files })
	return entries.map(({ sniffed, ...file }) =>
		forceTranscodePreview(file, sniffed),
	)
}

/** Hash every flat image file of the resource; nested media never contributes rows. */
async function buildImageHashes(api: ResourceAPI): Promise<ImageHashesResult> {
	const files = await flatFiles(api)
	const types = await classify(api, files)
	const images = files.filter((_, index) => types[index]?.kind === "image")
	const hashes = (
		await mapConcurrent(images, PLUGIN_IMAGE_PROBE_CONCURRENCY, (filename) =>
			imageHashesForFile(api, filename),
		)
	).flat()
	return { hashes }
}
