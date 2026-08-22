/**
 * Canonical extension-to-MIME mapping for all file types served by the
 * resource file pipeline. Shared between the HTTP file-serving layer and
 * the thumbnail/cover service so both produce consistent Content-Type
 * headers.
 */
export const DOWNLOAD_CONTENT_TYPES: Readonly<Record<string, string>> = {
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
	".svg": "image/svg+xml",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".m4v": "video/x-m4v",
	".avi": "video/x-msvideo",
	".3gp": "video/3gpp",
	".mp3": "audio/mpeg",
	".flac": "audio/flac",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".wav": "audio/wav",
	".opus": "audio/opus",
	".aac": "audio/aac",
	".txt": "text/plain",
	".md": "text/markdown",
	".epub": "application/epub+zip",
}
