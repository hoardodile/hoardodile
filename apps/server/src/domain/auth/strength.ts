export type PasswordStrength = "weak" | "ok"

/**
 * Cheap deterministic strength assessment for the single-user admin
 * password. The schemas only enforce `MIN_PASSWORD_LENGTH = 4`, so this
 * exists to warn before exposing the library to the local network: NIST
 * recommends at least 8 characters, and all-digit passwords are trivially
 * guessable. Not a cracker — a warning, not a gate.
 */
export function assessPasswordStrength(password: string): PasswordStrength {
	if (password.length < 8) return "weak"
	if (/^\d+$/.test(password)) return "weak"
	return "ok"
}
