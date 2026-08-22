import type { MutableRef } from "src/infra/runtime-context.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import { buildCommitService, type CommitResult } from "./commit.ts"
import {
	buildStagingService,
	type StagedFile,
	type StagingService,
} from "./staging.ts"

export type { CommitResult, StagedFile }

/**
 * Resource upload facade. All uploads — ordered (one or more individual
 * files) and archive (a single zip) — stage into a single global pool
 * (`local/.tmp/staging/<fileId><ext>`) and are addressed by the
 * server-minted `fileId`. There is no per-batch `uploadId` grouping, so
 * adding, removing, or reordering staged files never requires
 * re-uploading bytes that have already been staged.
 *
 * Commit consumes the staged files by `fileId` and removes them on
 * success.
 */
export type ResUploads = StagingService & {
	/**
	 * Commit an ordered resource from the global staging pool.
	 * `fileIds` defines the final entry order; `names` (parallel to
	 * `fileIds`) carries the original client filenames that become the
	 * on-disk entry names. Consumed pool files are removed on success.
	 */
	commitOrderedByIds(
		id: string,
		fileIds: readonly string[],
		names: readonly string[] | undefined,
	): Promise<CommitResult>
	/**
	 * Commit a resource whose source is a single staged archive (zip).
	 * The archive is validated and installed as-is under the sanitized
	 * `filename`. The staged archive is removed on success.
	 */
	commitArchiveById(
		id: string,
		archiveFileId: string,
		filename: string,
	): Promise<CommitResult>
	/**
	 * Commit a resource whose source is a local directory tree (folder
	 * import). Files are copied with relative structure preserved.
	 */
	commitDirectoryTree(id: string, srcDir: string): Promise<CommitResult>
}

export type ResUploadsOptions = {
	/**
	 * Hard cap on the cumulative uncompressed byte size an archive upload
	 * is allowed to write. Defends against zip bombs whose compressed size
	 * sits below `MAX_UPLOAD_BYTES` but whose uncompressed payload could
	 * still exhaust the disk.
	 */
	readonly maxArchiveExtractedBytes: number
}

export function buildResourceUploads(
	paths: StoragePaths,
	options: ResUploadsOptions,
	readOnly: MutableRef<boolean>,
): ResUploads {
	const staging = buildStagingService(paths)
	const commit = buildCommitService(paths, options, readOnly)
	return {
		stageSingleFile: staging.stageSingleFile,
		stageArchive: staging.stageArchive,
		discardStagedFile: staging.discardStagedFile,
		resolveStagedFile: staging.resolveStagedFile,
		resolveStagedArchive: staging.resolveStagedArchive,
		commitOrderedByIds: commit.commitOrderedByIds,
		commitArchiveById: commit.commitArchiveById,
		commitDirectoryTree: commit.commitDirectoryTree,
	}
}
