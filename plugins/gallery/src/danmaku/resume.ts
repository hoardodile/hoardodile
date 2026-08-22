import { RESUME_MIN_REMAINING_MS } from "./types"

/**
 * Per-resource cache key for a file's resume offset (milliseconds as a
 * decimal string). The cache is already scoped to the current resource
 * by the host, so the key only needs to distinguish files within it.
 */
export function resumeCacheKey(filename: string): string {
	return filename === "" ? "resume" : `resume:${filename}`
}

/** Minimal cache-writer surface needed by {@link writeResume}. */
export type ResumeWriter = {
	readonly setCache: (key: string, value: string) => void
}

/**
 * Persist the resume offset for a file. Near the end of the media the
 * offset is cleared instead, and positions under one second are not
 * worth resuming from.
 */
export function writeResume(
	api: ResumeWriter,
	args: {
		readonly filename: string
		readonly currentMs: number
		readonly durationMs: number
	},
): void {
	const { currentMs, durationMs } = args
	const remaining = durationMs - currentMs
	const key = resumeCacheKey(args.filename)
	if (remaining <= RESUME_MIN_REMAINING_MS) {
		api.setCache(key, "")
	} else if (currentMs > 1000) {
		api.setCache(key, String(currentMs))
	}
}
