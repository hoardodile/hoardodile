import type { SSESource } from "@fastify/sse"
import type {
	PluginDownloadRequestedEvent,
	PluginDownloadResolvedEvent,
	ResourceMetaUpdatedEvent,
	StorageContextReloadedEvent,
} from "@hoardodile/schemas"

export type SseEvent =
	| ResourceMetaUpdatedEvent
	| StorageContextReloadedEvent
	| PluginDownloadRequestedEvent
	| PluginDownloadResolvedEvent

export type SseConnection = {
	send(source: SSESource): Promise<void> | void
	onClose(cb: () => void): void
}

export type SseBroadcaster = {
	addConnection(conn: SseConnection): () => void
	broadcast(event: SseEvent): void
	/**
	 * Number of live SSE connections. A plugin download consent cannot be
	 * answered without a connected web client, so this is what the consent
	 * broker checks before creating a ticket (fast `UNAVAILABLE` otherwise).
	 */
	connectionCount(): number
}

export function createSseBroadcaster(): SseBroadcaster {
	const connections = new Set<SseConnection>()

	function addConnection(conn: SseConnection): () => void {
		connections.add(conn)
		conn.onClose(() => {
			connections.delete(conn)
		})
		return () => {
			connections.delete(conn)
		}
	}

	function broadcast(event: SseEvent): void {
		const data = JSON.stringify(event)
		for (const conn of connections) {
			try {
				void conn.send({ data })
			} catch {
				// ignore send failures; connection will be cleaned up on close
			}
		}
	}

	function connectionCount(): number {
		return connections.size
	}

	return { addConnection, broadcast, connectionCount }
}
