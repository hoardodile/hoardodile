/**
 * Wire-format taxonomy of domain errors. The server classifies any thrown
 * value into one of these codes before sending it to the client; the client
 * then uses the same codes to render user-facing messages and trigger
 * targeted recovery.
 *
 * Adding a new code requires a matching entry in the server's `toTRPCError`
 * so the mapping stays exhaustive.
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

export type DomainErrorPayload = {
	readonly kind: string
	readonly message: string
	readonly details?: Readonly<Record<string, unknown>>
}

/**
 * Typed domain error. Carries:
 * - `code`: one of {@link domainErrorCodes}, i.e. the "bucket" of failure.
 * - `kind`: a stable machine-readable subtype (`resource.not_found`,
 *   `auth.wrong_password`) for the client to switch on.
 * - `message`: a user-safe string; MUST NOT include filesystem paths,
 *   secrets, or stack details.
 * - `details`: optional structured payload (ids, limits) that is safe to
 *   surface to the client.
 *
 * Anything the server wants to raise as a well-typed failure goes through
 * this class (or its helpers) so the tRPC translation layer stays total.
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

	toPayload(): DomainErrorPayload {
		const base: DomainErrorPayload = {
			kind: this.kind,
			message: this.message,
		}
		return this.details === undefined
			? base
			: { ...base, details: this.details }
	}
}

export function isDomainError(value: unknown): value is DomainError {
	if (value instanceof DomainError) return true
	// Structurally recognize host-side error copies (the plugin host keeps
	// its own DomainError to stay out of this package's dependency graph):
	// a closed-union `code` plus a string `kind` is specific enough.
	if (typeof value !== "object" || value === null) return false
	const candidate = value as { code?: unknown; kind?: unknown }
	return (
		typeof candidate.code === "string" &&
		domainErrorCodes.includes(candidate.code as DomainErrorCode) &&
		typeof candidate.kind === "string"
	)
}

export function notFound(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("NOT_FOUND", kind, message, details)
}

export function conflict(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("CONFLICT", kind, message, details)
}

export function invalid(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("VALIDATION", kind, message, details)
}

export function forbidden(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("FORBIDDEN", kind, message, details)
}

export function unauthorized(
	kind: string,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): DomainError {
	return new DomainError("UNAUTHORIZED", kind, message, details)
}
