export type WindowOpenDecision = "same-window" | "external" | "deny"

export function isLocalhostHttp(url: string): boolean {
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return false
		}
		return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost"
	} catch {
		return false
	}
}

/**
 * Single-window policy for `setWindowOpenHandler` / `will-navigate`.
 * Localhost stays in the existing BrowserWindow; other http(s) goes
 * to the OS browser; everything else is dropped.
 */
export function windowOpenDecision(url: string): WindowOpenDecision {
	if (isLocalhostHttp(url)) return "same-window"
	if (url.startsWith("https:") || url.startsWith("http:")) return "external"
	return "deny"
}

export async function isHttpReachable(
	url: string,
	timeoutMs = 800,
): Promise<boolean> {
	try {
		await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
		return true
	} catch {
		return false
	}
}
