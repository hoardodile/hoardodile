/**
 * Parse a JSON-serialised string-to-string record from a DB column.
 * Returns an empty object on any parse failure.
 */
export function parseRecord(raw: string): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(raw)
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			return {}
		const result: Record<string, string> = {}
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string") result[k] = v
		}
		return result
	} catch {
		return {}
	}
}
