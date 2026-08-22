/**
 * Canonical media-type knowledge: the extension sets, the extension →
 * MIME table and the MIME → media-kind mapping shared by content
 * plugins, the runtime host's sniffer and the server's classification
 * pipeline.
 *
 * Extensions are a **hint**, never the verdict: `ResourceAPI.sniff`
 * reads the file's magic bytes and only falls back to the tables here
 * when the content carries no recognizable signature (text formats).
 * The sets below therefore answer "which extensions do we expect to
 * decode", not "what is this file".
 *
 * Lower-case, with leading dot — match the output of
 * `path.extname(name).toLowerCase()`.
 *
 * Adding a new extension here widens classification everywhere at
 * once. Before adding, verify:
 * - sharp can extract width/height (image)
 * - ffprobe can read width/height/duration (video)
 * - ffprobe can read the stream/format metadata (audio), and the
 *   extension has an entry in `AUDIO_FFMPEG_INPUT_FORMAT`
 * - the extension has an entry in {@link EXT_MIME}
 * - the gallery plugin's transcode-required set reflects the format
 *   (browser-renderable originals stay native; HEIC/TIFF need the
 *   sharp preview pipeline)
 */
export const IMAGE_EXTS: ReadonlySet<string> = new Set([
	".jpg",
	".jpeg",
	".png",
	".webp",
	".gif",
	".bmp",
	".avif",
	".heic",
	".heif",
	".tif",
	".tiff",
	".svg",
	".jp2",
	".j2k",
	".jpx",
])

export const VIDEO_EXTS: ReadonlySet<string> = new Set([
	".mp4",
	".webm",
	".mov",
	".mkv",
	".m4v",
	".avi",
	".3gp",
])

export const AUDIO_EXTS: ReadonlySet<string> = new Set([
	".mp3",
	".flac",
	".ogg",
	".m4a",
	".wav",
	".opus",
	".aac",
])

/**
 * Video containers ffmpeg can demux from a forward-only pipe (matroska,
 * avi). ISO-BMFF files (.mp4/.mov/.m4v) keep their moov index at the end
 * of the file, so a stream attempt on a zip-entry source is guaranteed to
 * fail after burning a full probesize read — consumers (thumb pipeline,
 * cover probing) send those straight to the materialized entry instead.
 */
export const STREAMABLE_VIDEO_EXTS: ReadonlySet<string> = new Set([
	".webm",
	".mkv",
	".avi",
])

/**
 * ffmpeg `-f` container name for piped audio bytes (no filename hint).
 * `.opus` files are Ogg containers; `.m4a` is ISO-BMFF, demuxed by the
 * mp4 demuxer.
 */
export const AUDIO_FFMPEG_INPUT_FORMAT: Readonly<Record<string, string>> = {
	".mp3": "mp3",
	".flac": "flac",
	".ogg": "ogg",
	".opus": "ogg",
	".wav": "wav",
	".m4a": "mp4",
	".aac": "aac",
}

/**
 * ffmpeg `-f` container name keyed by **sniffed MIME type**, for piped
 * sources that have no filename ffprobe could key off. Content-derived
 * routing is what lets a mislabelled file still demux correctly, so
 * this table — not the extension one — drives `ResourceAPI.probe`.
 *
 * Several spellings map to the same container because magic-byte
 * matchers and IANA disagree on the canonical name (`audio/wav` vs
 * `audio/x-wav`, `video/vnd.avi` vs `video/x-msvideo`).
 */
export const MIME_FFMPEG_INPUT_FORMAT: Readonly<Record<string, string>> = {
	"video/mp4": "mp4",
	"video/quicktime": "mov",
	"video/webm": "webm",
	"video/x-matroska": "matroska",
	"video/matroska": "matroska",
	"video/vnd.avi": "avi",
	"video/x-msvideo": "avi",
	"video/avi": "avi",
	"video/ogg": "ogg",
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/flac": "flac",
	"audio/x-flac": "flac",
	"audio/ogg": "ogg",
	"audio/opus": "ogg",
	"audio/vorbis": "ogg",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/vnd.wave": "wav",
	"audio/wave": "wav",
	"audio/mp4": "mp4",
	"audio/x-m4a": "mp4",
	"audio/aac": "aac",
	"video/3gpp": "mp4",
	"application/ogg": "ogg",
	"application/x-matroska": "matroska",
	"application/mp4": "mp4",
}

/**
 * The audio mirror of {@link STREAMABLE_VIDEO_EXTS}: containers whose
 * headers lead the file, so ffmpeg/ffprobe can demux them from a
 * forward-only pipe. `.m4a` is ISO-BMFF with a trailing moov index, so
 * it must be probed from a materialized (seekable) entry.
 */
export const STREAMABLE_AUDIO_EXTS: ReadonlySet<string> = new Set([
	".mp3",
	".flac",
	".ogg",
	".opus",
	".wav",
	".aac",
])

/**
 * Media families a file can belong to. `other` covers everything the
 * media pipeline does not decode (text, documents, archives, ...) — it
 * is a real answer, not a failure.
 */
export const MEDIA_KINDS = ["image", "video", "audio", "other"] as const

export type MediaKind = (typeof MEDIA_KINDS)[number]

/**
 * Extension → canonical MIME type. Used as the *fallback* branch of
 * content sniffing: magic-byte detection covers binary media, while
 * text-based formats (`.txt`, `.md`, `.csv`, subtitles, ...) carry no
 * signature and can only be named by their extension.
 */
export const EXT_MIME: Readonly<Record<string, string>> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp",
	".avif": "image/avif",
	".heic": "image/heic",
	".heif": "image/heif",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".jp2": "image/jp2",
	".j2k": "image/jp2",
	".jpx": "image/jp2",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".avi": "video/vnd.avi",
	".3gp": "video/3gpp",
	".mp3": "audio/mpeg",
	".flac": "audio/flac",
	".ogg": "audio/ogg",
	".opus": "audio/opus",
	".m4a": "audio/mp4",
	".wav": "audio/wav",
	".aac": "audio/aac",
	".txt": "text/plain",
	".md": "text/markdown",
	".csv": "text/csv",
	".json": "application/json",
	".xml": "text/xml",
	".html": "text/html",
	".htm": "text/html",
	".svg": "image/svg+xml",
	".srt": "application/x-subrip",
	".vtt": "text/vtt",
	".ass": "text/x-ssa",
	".epub": "application/epub+zip",
	".pdf": "application/pdf",
	".zip": "application/zip",
	".cbz": "application/vnd.comicbook+zip",
	".cbr": "application/vnd.comicbook-rar",
	".rar": "application/vnd.rar",
	".7z": "application/x-7z-compressed",
	".cb7": "application/x-7z-compressed",
	".tar": "application/x-tar",
	".cbt": "application/x-tar",
}

/**
 * Container MIME types whose top-level type does not describe the
 * payload. Ogg and Matroska carry audio *or* video, and `application/*`
 * says nothing either way — the values here are the common case, and
 * `ResourceAPI.probe` overrides them with the stream layout ffprobe
 * actually reports.
 */
export const MIME_KIND_OVERRIDES: Readonly<Record<string, MediaKind>> = {
	"application/ogg": "audio",
	"application/x-matroska": "video",
	"application/mp4": "video",
}

/**
 * Media family of a MIME type: the override table first, then the
 * top-level type. Never throws — unknown types are `other`.
 */
export function mimeToKind(mime: string): MediaKind {
	const normalized = mime.toLowerCase()
	const override = MIME_KIND_OVERRIDES[normalized]
	if (override !== undefined) return override
	if (normalized.startsWith("image/")) return "image"
	if (normalized.startsWith("video/")) return "video"
	if (normalized.startsWith("audio/")) return "audio"
	return "other"
}

/** Canonical MIME type for an extension (leading dot), or `undefined`. */
export function extToMime(ext: string): string | undefined {
	return EXT_MIME[ext.toLowerCase()]
}
