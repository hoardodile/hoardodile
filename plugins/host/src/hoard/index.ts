/**
 * The hoard storage runtime: layout authority, versioned-write gate,
 * version directory mechanics, zip extract + bulk export helpers, and
 * the upload staging pool. Shared by the server, the CLI and future
 * shells so every consumer works against one storage implementation.
 */

export type { ZipStreamEntry } from "../archive/index.ts"
export {
	extractArchiveInto,
	listArchiveEntries,
	streamStoredZip,
	validateArchiveBudget,
} from "../archive/index.ts"
export type { DirSizeOptions } from "./dir-size.ts"
export { sumDirSizes } from "./dir-size.ts"
export {
	naturalSort,
	ORDER_MANIFEST_NAME,
	orderEntries,
	orderManifestPath,
	parseOrderManifest,
	readOrderManifest,
	writeOrderManifest,
} from "./order-manifest.ts"
export type {
	CreateStoragePathsOptions,
	LocalPaths,
	StoragePaths,
	VersionPaths,
} from "./paths.ts"
export {
	assertInside,
	assertSafeSegment,
	createStoragePaths,
	imageVariantKey,
	RESOURCE_DATA_DIR_NAME,
} from "./paths.ts"
export {
	commitVaultFile,
	discardVaultTempFile,
	PluginVaultPathError,
	parsePluginVaultDest,
	type VaultCommitResult,
	vaultFileSha256,
	vaultReadFile,
	vaultRemoveFile,
	vaultStatFile,
	vaultTempFile,
	vaultTotalSize,
} from "./plugin-vault.ts"
export type { OccupiedNames } from "./sanitize.ts"
export {
	createOccupiedNames,
	occupyEntryName,
	sanitizeEntryName,
	uniqueEntryName,
} from "./sanitize.ts"
export {
	findStagedArchiveFile,
	findStagedPoolFile,
	removeStagedPoolFile,
	resolveStagedPoolFiles,
	writeStagedArchiveFile,
	writeStagedPoolFile,
} from "./staging-dir.ts"
export type { CreateNextVersionResult } from "./version.ts"
export {
	createNextVersion,
	currentVersion,
	ensureBootstrapVersion,
	listVersions,
	readActiveVersion,
	versionedDbFile,
	versionedPath,
	writeActiveVersion,
} from "./version.ts"
export type {
	VersionedFolderOps,
	VersionedFolderSubjectKind,
} from "./versioned-folder-ops.ts"
export {
	archiveStaleFiles,
	buildVersionedFolderOps,
} from "./versioned-folder-ops.ts"
export type { VersionedWriteCommand } from "./write-versioned.ts"
export { writeVersioned } from "./write-versioned.ts"
