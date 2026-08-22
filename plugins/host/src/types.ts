/**
 * The plugin contract types now live in `@hoardodile/sdk-types` — the
 * single source of truth shared with the authoring SDK and the worker
 * sandbox. This module keeps the module path so internal imports stay
 * untouched; do not define contract shapes here.
 */
export type {
	AudioCoverArt,
	AudioInfo,
	AudioTags,
	Detection,
	FileType,
	ImageInfo,
	Logger,
	MediaKind,
	PluginDefinition,
	ProbeResult,
	ReadFileRange,
	ResourceAPI,
	VideoInfo,
} from "@hoardodile/sdk-types"
