/**
 * The plugin asset consent broker: the authorization gate between a
 * plugin's download request and the user's decision. Every download
 * creates a ticket with a short UUID, broadcasts it (SSE) for the web
 * consent dialog, and keeps the caller parked until the user answers,
 * the ticket times out, or the broker is disposed.
 *
 * - No connected web client → `UNAVAILABLE` fast-fail (a dialog nobody
 *   can answer must never be shown).
 * - Auto-approve for plugins the user "remembered" for this session
 *   (in-memory, cleared on restart).
 * - Per-plugin pending cap (a burst of downloads cannot stack tickets).
 * - Every resolution (decide / timeout / dispose) notifies the UI
 *   through `onResolved` so all tabs close their dialog entry.
 */
import { randomUUID } from "node:crypto"
import { pluginAssetError } from "@hoardodile/sdk-types"

/** A pending consent question, exactly as the dialog needs to render it. */
export type ConsentTicket = {
	readonly ticketId: string
	readonly pluginId: string
	readonly pluginName: string
	readonly url: string
	readonly dest: string
	readonly sizeBytes?: number
	readonly reason?: string
}

export type ConsentDecision = {
	readonly approved: boolean
}

export type ConsentBrokerDeps = {
	/** How long a ticket stays open before it auto-denies. */
	readonly timeoutMs: number
	/** Broadcast a new ticket to connected clients (SSE). */
	readonly onRequest?: (ticket: ConsentTicket) => void
	/** Broadcast a resolution (decide/timeout/dispose) to connected clients. */
	readonly onResolved?: (ticketId: string) => void
	/** Live SSE connection count; zero → fast `UNAVAILABLE`. */
	readonly connectionCount?: () => number
	/** Max concurrently pending tickets per plugin (default 4). */
	readonly maxPendingPerPlugin?: number
}

export type ConsentBroker = {
	/**
	 * Ask the user. Resolves `{ approved: true }` when granted (including
	 * a session-remembered plugin) or `{ approved: false }` when denied
	 * or timed out; throws `UNAVAILABLE`/`POLICY` for host-level refusals.
	 */
	readonly request: (
		ticket: Omit<ConsentTicket, "ticketId">,
	) => Promise<ConsentDecision>
	/** Record the user's answer; `remember` marks the plugin for the session. */
	readonly decide: (
		ticketId: string,
		approved: boolean,
		remember?: boolean,
	) => void
	/** Pending tickets (for SSE-reconnect rehydration). */
	readonly listPending: () => readonly ConsentTicket[]
	/** Resolve every pending ticket as denied (server shutdown). */
	readonly dispose: () => void
}

type Pending = {
	readonly ticket: ConsentTicket
	readonly resolve: (decision: ConsentDecision) => void
	readonly timer: ReturnType<typeof setTimeout>
}

export function createConsentBroker(deps: ConsentBrokerDeps): ConsentBroker {
	const pending = new Map<string, Pending>()
	const sessionAllowlist = new Set<string>()
	const maxPending = deps.maxPendingPerPlugin ?? 4

	function resolveTicket(ticketId: string, approved: boolean): void {
		const entry = pending.get(ticketId)
		if (entry === undefined) return
		pending.delete(ticketId)
		clearTimeout(entry.timer)
		entry.resolve({ approved })
		deps.onResolved?.(ticketId)
	}

	function request(
		ticket: Omit<ConsentTicket, "ticketId">,
	): Promise<ConsentDecision> {
		if (deps.connectionCount !== undefined && deps.connectionCount() === 0) {
			return Promise.reject(
				pluginAssetError(
					"UNAVAILABLE",
					"plugin download consent needs a connected client — no browser session is attached",
				),
			)
		}
		// Session-remember semantics: once a plugin is on the allowlist
		// ("remember for this session"), every later download from it is
		// auto-approved WITHOUT re-reviewing the new URL — the user opted
		// into plugin-wide trust for this server session, and the destination
		// is still confined to the plugin's own vault. The dialog copy and
		// the manifest docs both say so; the list is in-memory and cleared
		// on restart.
		if (sessionAllowlist.has(ticket.pluginId)) {
			return Promise.resolve({ approved: true })
		}
		const concurrent = [...pending.values()].filter(
			(p) => p.ticket.pluginId === ticket.pluginId,
		).length
		if (concurrent >= maxPending) {
			return Promise.reject(
				pluginAssetError(
					"POLICY",
					`plugin ${ticket.pluginId} already has ${concurrent} pending download(s)`,
				),
			)
		}
		const ticketId = randomUUID()
		const full: ConsentTicket = { ticketId, ...ticket }
		return new Promise<ConsentDecision>((resolve) => {
			const timer = setTimeout(() => {
				resolveTicket(ticketId, false)
			}, deps.timeoutMs)
			pending.set(ticketId, { ticket: full, resolve, timer })
			deps.onRequest?.(full)
		})
	}

	function decide(ticketId: string, approved: boolean, remember = false): void {
		const entry = pending.get(ticketId)
		if (entry === undefined) return
		if (remember && approved) {
			sessionAllowlist.add(entry.ticket.pluginId)
		}
		resolveTicket(ticketId, approved)
	}

	function listPending(): readonly ConsentTicket[] {
		return [...pending.values()].map((p) => p.ticket)
	}

	function dispose(): void {
		for (const ticketId of [...pending.keys()]) {
			resolveTicket(ticketId, false)
		}
	}

	return { request, decide, listPending, dispose }
}
