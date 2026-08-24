/**
 * @hoardodile/sdk-server — the authoring surface for plugin `main.js`
 * files, and the only package plugin authors need on the server side.
 * The plugin contract (`definePlugin`, `ResourceAPI`, fixtures, hook
 * names) lives in @hoardodile/sdk-types and is re-exported here so
 * authors have a single import root.
 *
 * This package is fully MIT and dependency-closed within the SDK — it
 * never imports `@hoardodile/host` (the app-side runtime). Dev-time
 * test tooling (`runPluginHook`, `createDirectoryResourceAPI`) lives in
 * `@hoardodile/host` and is consumed from plugin tests as a
 * devDependency.
 */

export type {
	ArchiveExtraction,
	ArchiveExtractionEntry,
	AudioCoverArt,
	AudioInfo,
	AudioTags,
	ContainerListing,
	Detection,
	FileType,
	ImageHash,
	ImageHashesResult,
	ImageHashKind,
	ImageInfo,
	Logger,
	MediaKind,
	PluginAssetDeleteResult,
	PluginAssetError,
	PluginAssetErrorName,
	PluginDefinition,
	PluginDownloadRequest,
	PluginDownloadResult,
	ProbeResult,
	ReadFileRange,
	ResourceAPI,
	ResourceAPIFixtureConfig,
	VideoInfo,
} from "@hoardodile/sdk-types"
export {
	assertPluginShape,
	createFailingPlugin,
	createResourceAPIFixture,
	definePlugin,
	err,
	fileTypeFromName,
	isDetected,
	isErr,
	isMissed,
	isOk,
	isPluginAssetError,
	matchResult,
	ok,
	pluginAssetError,
	stubLogger,
} from "@hoardodile/sdk-types"
export type { Detector } from "./detectors.ts"
export {
	all,
	any,
	files,
	hasExt,
	hasKind,
	hasMime,
	hasName,
	minFiles,
	not,
} from "./detectors.ts"
