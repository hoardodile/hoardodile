import getPort from "get-port"

/**
 * Resolves an available TCP port for the server to bind to.
 *
 * Attempts to bind `preferredPort` first. If that port is already in use,
 * falls back to an OS-picked free ephemeral port.
 *
 * The probe binds the same host the server will listen on. Windows blocks
 * a wildcard bind while any specific-address socket (even a lingering
 * CLOSE_WAIT from a client that connected to an earlier instance) still
 * holds the port, so a host-scoped probe matches the real `listen()`
 * outcome instead of over-reporting conflicts.
 *
 * @param preferredPort - The port number to try first (e.g. from env.PORT).
 * @param host - The listen host (e.g. from env.HOST).
 * @returns The resolved port number that is guaranteed to be free at the time
 *   of the check. Note: there is a small TOCTOU window between this call and
 *   the actual `listen()` - negligible for local desktop use.
 */
export async function resolveAvailablePort(
	preferredPort: number,
	host: string,
): Promise<number> {
	const port = await getPort({ port: preferredPort, host })
	if (port !== preferredPort) {
		console.warn(
			`Preferred port ${preferredPort} is not available. Using ${port} instead.`,
		)
	}
	return port
}
