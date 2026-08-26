/**
 * The consent-dialog queue for plugin asset downloads — the shared
 * implementation both host apps mount:
 *
 * - the **app** feeds it from SSE (`pluginDownloadRequested` /
 *   `pluginDownloadResolved`) and drives decisions through the server
 *   (`pluginAsset.decide`); the resolved broadcast closes entries here;
 * - the **workbench** has no server: its asset engine enqueues via
 *   {@link request} and the dialog answers via {@link decide} — the same
 *   dialog component, one queue per page, FIFO, one dialog at a time.
 *
 * State-only by design: decisions never mutate the queue directly
 * except through `close`/`decide`, which the two hosts wire to their
 * own decision path.
 */

/**
 * One item of a batch consent question: a single download's URL and
 * vault destination, exactly as the dialog lists it.
 */
export type DownloadConsentItem = {
	readonly url: string
	readonly dest: string
	readonly sizeBytes?: number
	readonly reason?: string
}

/**
 * A queued consent question: the ticket shape. Structurally identical to
 * the server's `pluginDownloadRequested` SSE event minus its `type`
 * discriminator (and to `pluginAsset.listPending` rows) — declared here
 * instead of importing `@hoardodile/schemas` so the host-core package
 * stays dependency-lean.
 *
 * One entry = one dialog listing every item (a single download is an
 * items array of one; a batched plugin call is one entry for the whole
 * batch).
 */
export type DownloadConsentEntry = {
	readonly ticketId: string
	readonly pluginId: string
	readonly pluginName: string
	readonly items: readonly DownloadConsentItem[]
}

type State = {
	readonly queue: readonly DownloadConsentEntry[]
}

let state: State = { queue: [] }
const listeners = new Set<() => void>()

/** Engine side: tickets awaiting a local decision (workbench path). */
const pending = new Map<
	string,
	{ readonly resolve: (approved: boolean) => void }
>()

function setState(next: State): void {
	state = next
	for (const listener of listeners) {
		listener()
	}
}

export function subscribeDownloadConsent(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getDownloadConsentSnapshot(): State {
	return state
}

/** A new ticket arrived (SSE) or was requested locally: append if absent. */
export function enqueueDownloadConsent(entry: DownloadConsentEntry): void {
	for (const existing of state.queue) {
		if (existing.ticketId === entry.ticketId) return
	}
	setState({ queue: [...state.queue, entry] })
}

/** A ticket resolved (decide/timeout/dispose): drop it in every consumer. */
export function closeDownloadConsent(ticketId: string): void {
	const queue = state.queue.filter((entry) => entry.ticketId !== ticketId)
	if (queue.length === state.queue.length) return
	setState({ queue })
}

/**
 * Replace the queue from a pending list (app: `listPending` after an SSE
 * reconnect; workbench: same API on restart).
 */
export function rehydrateDownloadConsent(
	entries: readonly DownloadConsentEntry[],
): void {
	const byTicket = new Map<string, DownloadConsentEntry>()
	for (const entry of entries) byTicket.set(entry.ticketId, entry)
	setState({ queue: [...byTicket.values()] })
}

/**
 * Enqueue a ticket and wait for its decision (workbench engine path).
 * The dialog's answer arrives through {@link decideDownloadConsent}.
 */
export function requestDownloadConsent(
	entry: DownloadConsentEntry,
): Promise<boolean> {
	if (pending.has(entry.ticketId)) {
		return Promise.resolve(false)
	}
	enqueueDownloadConsent(entry)
	return new Promise<boolean>((resolve) => {
		pending.set(entry.ticketId, { resolve })
	})
}

/**
 * Answer a ticket from the dialog. Closes the entry and resolves any
 * awaiting engine call. Idempotent; unknown tickets are a no-op.
 */
export function decideDownloadConsent(
	ticketId: string,
	approved: boolean,
): void {
	const waiter = pending.get(ticketId)
	if (waiter !== undefined) {
		pending.delete(ticketId)
		waiter.resolve(approved)
	}
	closeDownloadConsent(ticketId)
}

/** Test-only: reset the singleton between tests. */
export function resetDownloadConsent(): void {
	for (const waiter of pending.values()) waiter.resolve(false)
	pending.clear()
	setState({ queue: [] })
}
