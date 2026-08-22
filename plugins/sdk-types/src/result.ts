/**
 * Shared `ok: true/false` result vocabulary (Rust's `Result` in spirit,
 * spread payloads in shape): every site that answers "did it work?" —
 * detections, parses, validations, benchmark runs — uses one type
 * family, one pair of constructors and one pair of guards instead of
 * hand-rolling its own union.
 *
 * The payloads are spread onto the marker rather than carried in a
 * `value`/`error` channel: `ok({ start, end })` is literally
 * `{ ok: true, start, end }`. This keeps every existing consumer's
 * field access (`r.start`, `r.code`, `r.failure`) and every `toEqual`
 * assertion working unchanged, and lets the plugin-facing `{ ok: true }`
 * literal stay the contract.
 */
export type Ok<TPayload extends object = object> = {
	readonly ok: true
} & TPayload
export type Err<TPayload extends object = object> = {
	readonly ok: false
} & TPayload
export type Result<TOk extends object = object, TErr extends object = object> =
	| Ok<TOk>
	| Err<TErr>

/**
 * Build the success variant; `ok()` alone yields `{ ok: true }`. The
 * cast is the constructor boundary: the runtime value is exactly
 * `{ ok: true, ...payload }`, which the generic spread cannot prove.
 */
export function ok<TPayload extends object = object>(
	payload?: TPayload,
): Ok<TPayload> {
	return { ok: true, ...payload } as Ok<TPayload>
}

/**
 * Build the failure variant; `err()` alone yields `{ ok: false }`. See
 * {@link ok} for the constructor-boundary cast.
 */
export function err<TPayload extends object = object>(
	payload?: TPayload,
): Err<TPayload> {
	return { ok: false, ...payload } as Err<TPayload>
}

/** Narrow a result to its success variant. */
export function isOk<TOk extends object, TErr extends object>(
	result: Result<TOk, TErr>,
): result is Ok<TOk> {
	return result.ok === true
}

/** Narrow a result to its failure variant. */
export function isErr<TOk extends object, TErr extends object>(
	result: Result<TOk, TErr>,
): result is Err<TErr> {
	return result.ok === false
}

/**
 * Destructure a result through one of two handlers — the pattern-match
 * combinator. Both handlers must produce `R`; the chosen one receives
 * the spread payload of its variant.
 */
export function matchResult<TOk extends object, TErr extends object, R>(
	result: Result<TOk, TErr>,
	handlers: {
		readonly ok: (payload: Ok<TOk>) => R
		readonly err: (payload: Err<TErr>) => R
	},
): R {
	return isOk(result) ? handlers.ok(result) : handlers.err(result)
}
