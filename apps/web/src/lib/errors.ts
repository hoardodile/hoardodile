/**
 * Resolve the user-facing message for a thrown error: the error's own
 * message when present, else `fallback`. Server errors surface their
 * message directly; anything else (or an empty message) falls back so the
 * toast is never blank. Unifies the ad-hoc
 * `err instanceof Error ? err.message : fallback` pattern used across the
 * app's mutation handlers.
 */
export function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message.length > 0 ? err.message : fallback
}
