import { pluginRequestTimeouts } from "@hoardodile/sdk-web"
import {
	canWaitForStorage,
	LONG_RUNNING_TRPC_PROCEDURES,
	STORAGE_COMMIT_TIMEOUT_MS,
} from "@hoardodile/shared/trpc-timeouts"

/**
 * Cap for a normal tRPC round trip; the UI must never wait forever
 * (skeletons). Long-running procedures are exempted below.
 */
export const TRPC_TIMEOUT_MS = 15_000

/** The wire ceiling for every long-running procedure on the table. */
export const LONG_RUNNING_TRPC_TIMEOUT_MS = pluginRequestTimeouts.download

function requestUrl(input: string | URL | Request): string {
	if (typeof input === "string") return input
	if (input instanceof URL) return input.href
	return input.url
}

/**
 * The abort timeout for a tRPC request URL. `pluginAsset.request` parks
 * the server call until the user answers the consent dialog (and then
 * waits for the transfer), so it must outlive the default round-trip cap;
 * same for big archive extraction. Everything else keeps the short cap.
 * The procedure list lives in `@hoardodile/shared/trpc-timeouts` (next to
 * the server-side definitions) so it cannot drift.
 */
export function trpcTimeoutMs(input: string | URL | Request): number {
	if (canWaitForStorage(requestUrl(input))) return STORAGE_COMMIT_TIMEOUT_MS
	const path = new URL(requestUrl(input)).pathname
	// A single batch POST can carry several procedures at once
	// (`/trpc/a,b?batch=1`), and only the first segment keeps the
	// leading `/trpc/` — match each comma-separated segment on the
	// segment boundary so a long-running procedure anywhere in the batch
	// keeps its ceiling.
	const segments = path.split(",").map((segment) => segment.replace(/^\/+/, ""))
	return LONG_RUNNING_TRPC_PROCEDURES.some((procedure) =>
		segments.some(
			(segment) => segment === procedure || segment.endsWith(`/${procedure}`),
		),
	)
		? LONG_RUNNING_TRPC_TIMEOUT_MS
		: TRPC_TIMEOUT_MS
}
