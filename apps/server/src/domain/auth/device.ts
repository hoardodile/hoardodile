export type ConnectionOrigin = "loopback" | "lan"

/**
 * Whether a remote address is a loopback peer. Single definition shared by
 * the desktop control routes and the connection log.
 */
export function isLoopbackIp(remoteAddress: string | undefined): boolean {
	return (
		remoteAddress === "127.0.0.1" ||
		remoteAddress === "::1" ||
		remoteAddress === "::ffff:127.0.0.1"
	)
}

export function classifyOrigin(
	remoteAddress: string | undefined,
): ConnectionOrigin {
	return isLoopbackIp(remoteAddress) ? "loopback" : "lan"
}

/**
 * Human-readable device label derived from the user agent. Only the label
 * is persisted — the raw user agent (which carries fingerprint-detail) is
 * never written to disk.
 */
export function describeDevice(userAgent: string | undefined): string {
	if (userAgent !== undefined && /Electron\//.test(userAgent)) {
		return "Electron desktop"
	}
	const browser = browserName(userAgent)
	const os = osName(userAgent)
	if (browser !== undefined && os !== undefined) return `${browser} on ${os}`
	if (browser !== undefined) return browser
	if (os !== undefined) return os
	return "Unknown device"
}

function browserName(userAgent: string | undefined): string | undefined {
	if (userAgent === undefined) return undefined
	if (/Edg\//.test(userAgent)) return "Edge"
	if (/OPR\//.test(userAgent)) return "Opera"
	if (/Firefox\//.test(userAgent)) return "Firefox"
	if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) return "Chrome"
	if (/Safari\//.test(userAgent)) return "Safari"
	return undefined
}

function osName(userAgent: string | undefined): string | undefined {
	if (userAgent === undefined) return undefined
	if (/Windows/.test(userAgent)) return "Windows"
	if (/iPhone|iPad|iPod/.test(userAgent)) return "iOS"
	if (/Mac OS X|Macintosh/.test(userAgent)) return "macOS"
	if (/Android/.test(userAgent)) return "Android"
	if (/Linux/.test(userAgent)) return "Linux"
	return undefined
}
