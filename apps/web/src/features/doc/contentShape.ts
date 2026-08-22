/**
 * Storage-shape knowledge for document bodies. Kept in one tiny pure
 * module so the editor, the diff machinery and any future consumer agree
 * on the persisted `{version, blocks}` format and can normalize legacy
 * payloads without importing each other.
 */

/**
 * Version tag written into every saved payload. Bumped when the editor's
 * draft shape changes so stale entries are discarded instead of replayed.
 */
export const CURRENT_DOC_STORAGE_VERSION = 4

/**
 * Extract the editable `blocks` array from a stored content payload.
 *
 * Legacy empty documents were persisted as `{type:"doc",content:[]}` (the
 * server's empty-draft fallback); treating that shape as an empty block
 * list keeps content comparisons stable across both formats so a
 * committed-empty document can never fabricate a conflict. Non-empty
 * legacy payloads (no `blocks` key) stay opaque — they are genuinely
 * different from any modern `{version,blocks}` payload.
 */
export function blocksOf(
	content: Record<string, unknown> | undefined,
): unknown[] | undefined {
	if (content === undefined) return undefined
	if (Array.isArray(content.blocks)) return content.blocks
	if (
		content.type === "doc" &&
		Array.isArray(content.content) &&
		content.content.length === 0
	) {
		return []
	}
	return undefined
}
