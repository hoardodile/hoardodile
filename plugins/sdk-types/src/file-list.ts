/**
 * One item in a serialized file list: a bare filename string or a
 * metadata object. Object entries carry `filename` plus any extra
 * fields; the host renders covers and chips from this shape.
 */
export type SerializedFileEntry =
	| string
	| Record<string, string | number | boolean>

/**
 * Serialized file list as stored in the sidecar cache and sent over the
 * wire. Order is the display order; the host preserves it verbatim.
 */
export type SerializedFileList = readonly SerializedFileEntry[]
