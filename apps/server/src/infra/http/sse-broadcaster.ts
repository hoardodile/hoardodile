import type { SSESource } from "@fastify/sse"
import type {
	ResourceMetaUpdatedEvent,
	StorageContextReloadedEvent,
} from "@hoardodile/schemas"

export type SseEvent = ResourceMetaUpdatedEvent | StorageContextReloadedEvent

export type SseConnection = {
	send(source: SSESource): Promise<void> | void
	onClose(cb: () => void): void
}

export type SseBroadcaster = {
	addConnection(conn: SseConnection): () => void
	broadcast(event: SseEvent): void
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

	return { addConnection, broadcast }
}
