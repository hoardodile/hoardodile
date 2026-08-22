import { hash, verify } from "@node-rs/argon2"

const ARGON2ID_OPTIONS = {
	memoryCost: 19456,
	timeCost: 2,
	parallelism: 1,
} as const

/**
 * Hash a plaintext password with argon2id using our tuned parameters.
 *
 * @throws `Error` when `password` is empty.
 */
export async function hashPassword(password: string): Promise<string> {
	if (password.length === 0) throw new Error("password must not be empty")
	return hash(password, ARGON2ID_OPTIONS)
}

export type VerifyLogger = {
	readonly error: (obj: object, msg?: string) => void
}

/**
 * Verify a plaintext password against a stored argon2id hash.
 *
 * Returns `false` on malformed hashes rather than throwing, so callers can
 * treat verification uniformly as a boolean predicate. Unexpected errors
 * (corrupt or wrong-format hash, native binding failure, etc.) are
 * forwarded to the optional `logger` before being collapsed to `false`,
 * so a misconfigured deployment is never silently indistinguishable from
 * a wrong password in the logs.
 */
export async function verifyPassword(
	hashString: string,
	password: string,
	logger?: VerifyLogger,
): Promise<boolean> {
	try {
		return await verify(hashString, password)
	} catch (err) {
		logger?.error(
			{ err: errorPayload(err) },
			"verifyPassword: unexpected error",
		)
		return false
	}
}

function errorPayload(err: unknown): { name: string; message: string } {
	if (err instanceof Error) {
		return { name: err.name, message: err.message }
	}
	return { name: "Unknown", message: String(err) }
}
