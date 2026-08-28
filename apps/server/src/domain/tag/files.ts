import {
	buildImageSlotFiles,
	type ImageSlotFiles,
} from "src/infra/image-slots/files.ts"
import type { MutableRef } from "src/infra/runtime-context.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

/** The tag's single image slot name (on disk: `image.<ext>`). */
export const TAG_IMAGE_SLOT = "image"

/**
 * Tag image slot (`image.<ext>`) file-system layer, built on the shared
 * image-slot kernel. All writes target the current archive version; reads
 * accept a version so callers can resolve against `imageVersion`. The
 * kernel owns the versioned write gate, stale-file archiving to
 * `local/cache/tags/<id>` and the trash / `.deleted` lifecycle.
 */
export type TagFiles = ImageSlotFiles

export function buildTagFiles(
	paths: StoragePaths,
	readOnly: MutableRef<boolean>,
): TagFiles {
	return buildImageSlotFiles({ paths, readOnly, subjectKind: "tag" })
}
