import type { QueryClient } from "@tanstack/react-query"
import type { HostHandlerEntry } from "./handlers/registry"
import { createHostMessageHandler } from "./host-message-handler"

// ── Ref-counted global postMessage handler ─────────────────────────────────

let globalHandler: ((event: MessageEvent) => void) | undefined
let handlerRefCount = 0

function addGlobalHandler(handler: (event: MessageEvent) => void): void {
	if (handlerRefCount === 0) {
		window.addEventListener("message", handler)
		globalHandler = handler
	}
	handlerRefCount++
}

function removeGlobalHandler(): void {
	handlerRefCount--
	if (handlerRefCount === 0 && globalHandler !== undefined) {
		window.removeEventListener("message", globalHandler)
		globalHandler = undefined
	}
}

// ── Auto-discovery via import.meta.glob ────────────────────────────────────

type HandlerModule = {
	readonly createHandlers: (qc: QueryClient) => readonly HostHandlerEntry[]
}

// Test files must never be globbed in: they import vitest, which breaks
// the browser bundle. Tests live in ./handlers/__tests__/ and the
// negative pattern below is the backstop for files added directly here.
const handlerModules = import.meta.glob<HandlerModule>(
	["./handlers/*.ts", "!./handlers/*.test.ts"],
	{ eager: true },
)

function buildHandlers(qc: QueryClient): HostHandlerEntry[] {
	const handlers: HostHandlerEntry[] = []
	for (const mod of Object.values(handlerModules)) {
		if (mod.createHandlers !== undefined) {
			handlers.push(...mod.createHandlers(qc))
		}
	}
	return handlers
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Registers the global postMessage handler once; call cleanup on unmount. */
export function ensureGlobalHandler(qc: QueryClient): () => void {
	const handler = createHostMessageHandler(buildHandlers(qc))
	addGlobalHandler(handler)
	return () => removeGlobalHandler()
}
