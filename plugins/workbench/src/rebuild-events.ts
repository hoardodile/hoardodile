/**
 * Client-side subscription to the workbench dev server's rebuild stream.
 * `hoardodile plugin dev` watch-builds the plugin and broadcasts a
 * `rebuild` event over `/api/workbench/events` (SSE) once it has
 * invalidated and re-captured the hook snapshots; the workbench page
 * listens here and reloads its plugin iframe in response.
 */

/** `true` when an SSE `data` string is a plugin-rebuild signal. */
export function isRebuildEvent(data: string): boolean {
	try {
		const parsed = JSON.parse(data) as unknown
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			(parsed as { kind?: unknown }).kind === "rebuild"
		)
	} catch {
		return false
	}
}

/**
 * Subscribe to the dev server's rebuild stream. Calls `onRebuild` for each
 * `rebuild` SSE frame; other frames (`ready`, pings) are ignored. Returns
 * an unsubscribe that closes the connection.
 */
export function subscribeToPluginRebuilds(onRebuild: () => void): () => void {
	const source = new EventSource("/api/workbench/events")
	const onMessage = (event: MessageEvent<string>) => {
		if (isRebuildEvent(event.data)) onRebuild()
	}
	source.addEventListener("message", onMessage)
	return () => {
		source.removeEventListener("message", onMessage)
		source.close()
	}
}
