import type { PluginAssetErrorName } from "@hoardodile/sdk-types"
import { isPluginAssetError } from "@hoardodile/sdk-types"
import { type DomainError, isDomainError } from "@hoardodile/shared"
import { TRPCError } from "@trpc/server"
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc"

/**
 * Map the plugin asset vocabulary to HTTP-shaped tRPC codes: policy
 * rejections are the plugin's bad request, "no consent channel" and
 * read-only archives surface as NOT_IMPLEMENTED, user declines as
 * FORBIDDEN. (tRPC v11 has no UNAVAILABLE code; the machine-readable
 * name travels separately via the error formatter.)
 */
const TRPC_CODE_BY_ASSET_ERROR = {
	POLICY: "BAD_REQUEST",
	UNAVAILABLE: "NOT_IMPLEMENTED",
	DENIED: "FORBIDDEN",
} as const satisfies Record<PluginAssetErrorName, TRPC_ERROR_CODE_KEY>

/**
 * Map a {@link DomainError} code to the closest tRPC error code. Keeping
 * this tiny, total, and centralised ensures every domain bucket has exactly
 * one HTTP-shaped representation on the wire.
 */
const TRPC_CODE_BY_DOMAIN_CODE = {
	NOT_FOUND: "NOT_FOUND",
	CONFLICT: "CONFLICT",
	VALIDATION: "BAD_REQUEST",
	UNAUTHORIZED: "UNAUTHORIZED",
	FORBIDDEN: "FORBIDDEN",
	RATE_LIMITED: "TOO_MANY_REQUESTS",
	UNSUPPORTED: "METHOD_NOT_SUPPORTED",
	INTERNAL: "INTERNAL_SERVER_ERROR",
} as const satisfies Record<DomainError["code"], TRPC_ERROR_CODE_KEY>

/**
 * Convert any thrown value into a {@link TRPCError}. Known
 * {@link DomainError}s are mapped to their tRPC counterpart and keep their
 * structured payload (accessible to the client via `cause`); plugin asset
 * errors keep their machine-readable name (the iframe bridge forwards it
 * to plugin code via `err.name`). Unknown throws collapse to
 * `INTERNAL_SERVER_ERROR` with a generic message so stack traces and raw
 * paths never cross the wire.
 */
export function toTRPCError(err: unknown): TRPCError {
	if (err instanceof TRPCError) return err
	if (isDomainError(err)) {
		return new TRPCError({
			code: TRPC_CODE_BY_DOMAIN_CODE[err.code],
			message: err.message,
			cause: err,
		})
	}
	if (
		isPluginAssetError(err, "POLICY") ||
		isPluginAssetError(err, "UNAVAILABLE") ||
		isPluginAssetError(err, "DENIED")
	) {
		return new TRPCError({
			code: TRPC_CODE_BY_ASSET_ERROR[err.code],
			message: err.message,
			cause: err,
		})
	}
	return new TRPCError({
		code: "INTERNAL_SERVER_ERROR",
		message: "internal error",
		cause: err instanceof Error ? err : undefined,
	})
}
