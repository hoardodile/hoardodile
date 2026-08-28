/** Prepend `https://` when the user pasted a scheme-less address. */
export function withScheme(url: string): string {
	return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}

/** Hostname of `url` (scheme-less pastes normalised first), without `www.`. */
export function hostnameOf(url: string): string | undefined {
	try {
		return new URL(withScheme(url)).hostname.replace(/^www\./, "")
	} catch {
		return undefined
	}
}
