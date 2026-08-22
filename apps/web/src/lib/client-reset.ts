const KNOWN_INDEXED_DB_NAMES = [
	"hoardodile-usage-queue",
	"hoardodile-doc-draft-cache",
] as const

const RELOAD_OVERLAY_ID = "reload-loading-overlay"

function showReloadOverlay(message?: string): void {
	if (typeof document === "undefined") return
	if (document.getElementById(RELOAD_OVERLAY_ID) !== null) return

	const overlay = document.createElement("div")
	overlay.id = RELOAD_OVERLAY_ID
	overlay.setAttribute("role", "status")
	overlay.setAttribute("aria-live", "polite")
	overlay.className =
		"fixed inset-0 z-100 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm text-foreground"

	const spinner = document.createElement("div")
	spinner.className =
		"size-8 animate-spin rounded-full border-4 border-muted-foreground/30 border-t-foreground"
	spinner.setAttribute("aria-hidden", "true")
	overlay.appendChild(spinner)

	if (message !== undefined && message.length > 0) {
		const text = document.createElement("p")
		text.className = "text-sm font-medium"
		text.textContent = message
		overlay.appendChild(text)
	}

	document.body.appendChild(overlay)
}

function deleteIndexedDb(name: string): Promise<void> {
	return new Promise((resolve) => {
		if (typeof indexedDB === "undefined") {
			resolve()
			return
		}
		const request = indexedDB.deleteDatabase(name)
		request.addEventListener("success", () => resolve())
		request.addEventListener("error", () => resolve())
		request.addEventListener("blocked", () => resolve())
	})
}

/**
 * Wipe all persisted client-side state and reload the page.
 *
 * This is used when the server has replaced its underlying SQLite database
 * (backup restore or archive version switch). A full reset guarantees that
 * no stale cache, localStorage, IndexedDB, or service-worker cache survives
 * the transition.
 *
 * @param message - Optional message shown on a blocking overlay while the
 *   cleanup and reload happen. Pass a translated string.
 */
export async function hardResetAndReload(message?: string): Promise<void> {
	showReloadOverlay(message)

	// Best-effort cleanup: never let a cleanup failure block the reload.
	try {
		if ("serviceWorker" in navigator) {
			const registrations = await navigator.serviceWorker.getRegistrations()
			await Promise.allSettled(
				registrations.map((registration) => registration.unregister()),
			)
		}
	} catch {
		// ignore
	}

	try {
		if ("caches" in window) {
			const keys = await caches.keys()
			await Promise.allSettled(keys.map((key) => caches.delete(key)))
		}
	} catch {
		// ignore
	}

	try {
		if ("localStorage" in window) {
			localStorage.clear()
		}
	} catch {
		// ignore
	}

	try {
		if ("sessionStorage" in window) {
			sessionStorage.clear()
		}
	} catch {
		// ignore
	}

	try {
		await Promise.allSettled(
			KNOWN_INDEXED_DB_NAMES.map((name) => deleteIndexedDb(name)),
		)

		if ("databases" in indexedDB) {
			try {
				const databases = await indexedDB.databases()
				await Promise.allSettled(
					databases
						.map((db) => db.name)
						.filter((name): name is string => name !== undefined)
						.map((name) => deleteIndexedDb(name)),
				)
			} catch {
				// ignore
			}
		}
	} catch {
		// ignore
	}

	window.location.reload()
}
