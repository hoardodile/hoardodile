/**
 * Host-local domain error. Mirrors the wire-format taxonomy of the app's
 * domain errors (`@hoardodile/shared`) so errors raised here keep their
 * code/kind/details across the package boundary — the server's error
 * translation recognizes this shape structurally via `isDomainError`.
 *
 * The host deliberately keeps its dependency graph minimal (consts +
 * sdk-types only) and does not depend on `@hoardodile/shared`; the
 * mirror is kept in sync by the bridge test in
 * `apps/server/src/infra/host-errors.test.ts`.
 */
export const domainErrorCodes = [
	"NOT_FOUND",
	"CONFLICT",
	"VALIDATION",
	"UNAUTHORIZED",
	"FORBIDDEN",
	"RATE_LIMITED",
	"UNSUPPORTED",
	"INTERNAL",
] as const

export type DomainErrorCode = (typeof domainErrorCodes)[number]

/**
 * Host-local domain error carrying a wire-compatible code/kind/details
 * triple. Thrown by host services (containers, loaders, hooks) so the
 * server can translate them into its own domain errors verbatim.
 */
export class DomainError extends Error {
	readonly code: DomainErrorCode
	readonly kind: string
	readonly details?: Readonly<Record<string, unknown>>

	constructor(
		code: DomainErrorCode,
		kind: string,
		message: string,
		details?: Readonly<Record<string, unknown>>,
	) {
		super(message)
		this.name = "DomainError"
		this.code = code
		this.kind = kind
		if (details !== undefined) this.details = details
	}
}

/** Convenience constructor for `VALIDATION` errors. */
export function invalid(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("VALIDATION", kind, message, details)
}

/** Convenience constructor for `CONFLICT` errors. */
export function conflict(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("CONFLICT", kind, message, details)
}

/** Convenience constructor for `NOT_FOUND` errors. */
export function notFound(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("NOT_FOUND", kind, message, details)
}
