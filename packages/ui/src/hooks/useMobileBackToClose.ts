import {
	createContext,
	createElement,
	type ReactNode,
	useContext,
	useId,
	useLayoutEffect,
	useRef,
} from "react"
import { flushSync } from "react-dom"
import { getMobileBackController } from "../lib/mobile-back-browser"
import type { MobileBackRegistry } from "../lib/mobile-back-stack"

const RegistryContext = createContext<MobileBackRegistry | undefined>(undefined)
const ParentContext = createContext<string | undefined>(undefined)
const inactiveRegistry: MobileBackRegistry = { set() {}, remove() {} }

/** Hosts and SDK roots can supply a browser or message-backed registry. */
export function MobileBackProvider({
	registry,
	children,
}: {
	readonly registry: MobileBackRegistry
	readonly children?: ReactNode
}) {
	return createElement(RegistryContext, { value: registry }, children)
}

/** Internal component boundary: preserves ancestry across portals. */
export function MobileBackScope({
	id,
	children,
}: {
	readonly id: string
	readonly children: ReactNode
}) {
	return createElement(ParentContext, { value: id }, children)
}

export function useMobileBackScope(
	open: boolean | undefined,
	onOpenChange: ((open: boolean) => void) | undefined,
): string {
	const supplied = useContext(RegistryContext)
	const parentId = useContext(ParentContext)
	const id = useId()
	// Sandboxed frames must use the SDK bridge. They must never create their
	// own entries in the browser's joint session history.
	const registry =
		supplied ??
		(typeof window !== "undefined" && window.parent === window
			? getMobileBackController()
			: inactiveRegistry)
	const state = useRef({ open, onOpenChange })
	useLayoutEffect(() => {
		state.current = { open, onOpenChange }
		if (open !== true || onOpenChange === undefined) {
			registry.remove(id)
			return
		}
		registry.set({
			id,
			parentId,
			isOpen: () => state.current.open === true,
			close() {
				// Browser/message callbacks run outside React commits. Read the
				// accepted controlled value before reconciling history.
				flushSync(() => state.current.onOpenChange?.(false))
			},
		})
	})
	useLayoutEffect(() => () => registry.remove(id), [registry, id])
	return id
}

export function useMobileBackToClose(
	open: boolean | undefined,
	onOpenChange: ((open: boolean) => void) | undefined,
): void {
	useMobileBackScope(open, onOpenChange)
}

/** @deprecated Navigation now uses an explicit history adapter. Kept for old consumers. */
export function setNavigationResolver(
	_resolver: (onResolved: () => void) => () => void,
): void {}
