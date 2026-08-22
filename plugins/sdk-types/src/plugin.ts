/**
 * Plugin-facing runtime limits: the read cap plugins must respect and
 * the fan-out bounds plugins should stay within when probing. Sandbox
 * tuning (watchdog, timeouts, memory) is app-side and lives in
 * `@hoardodile/host` instead.
 */

/**
 * Upper bound for a single `readFile` call, full or ranged. Anything
 * bigger must go through byte ranges (`readFileChunks`) so neither the
 * host process nor the plugin worker buffers it whole.
 */
export const PLUGIN_READ_FILE_MAX_BYTES = 128 * 1024 * 1024

/**
 * Parallel image probes a plugin hook may fan out across the host.
 * Host-side probes run sharp concurrently; keep them bounded.
 */
export const PLUGIN_IMAGE_PROBE_CONCURRENCY = 8

/**
 * Parallel video probes a plugin hook may fan out. Each spawns an
 * ffprobe process host-side, so videos are bound tighter than images.
 */
export const PLUGIN_VIDEO_PROBE_CONCURRENCY = 4

/**
 * Parallel audio probes a plugin hook may fan out. Shares the ffprobe
 * spawn budget with video, so it carries the same bound.
 */
export const PLUGIN_AUDIO_PROBE_CONCURRENCY = 4

/**
 * How many audio files a `coverLocal` hook scans looking for embedded
 * artwork before settling for the first audio file. Albums carry the
 * same artwork on every track, so the scan almost always stops at the
 * first probe; the cap keeps a pathological archive from spawning one
 * ffprobe per track.
 */
export const PLUGIN_AUDIO_COVER_SCAN_LIMIT = 8

/**
 * Chunk size for batch `statFiles` calls: the host resolves each chunk
 * in one RPC round-trip, so a 100-file archive costs ~13 round-trips
 * instead of 100.
 */
export const PLUGIN_STAT_CONCURRENCY = 8

/**
 * Batch size for animation scans in `searchMeta` hooks: probes run
 * concurrently within a batch, and the early-exit check happens between
 * batches.
 */
export const PLUGIN_ANIMATION_SCAN_BATCH = 8
