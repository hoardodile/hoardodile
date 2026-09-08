import type {
	HostPush,
	OverlayRegistry,
	PluginRequests,
} from "@hoardodile/sdk-web"

type Sync = PluginRequests["overlaySync"]["input"]
type Binding = {
	readonly resId: string
	readonly session: string
	revision: number
	readonly entries: Map<string, { open: boolean }>
}

/** Shared by the SPA and Workbench, behind their existing source validation. */
export function createOverlayHost(options: {
	readonly registry: OverlayRegistry
	readonly send: (source: unknown, message: HostPush) => void
}) {
	const bindings = new Map<unknown, Binding>()
	const instance = Math.random().toString(36).slice(2)
	let nextSession = 0
	function key(binding: Binding, id: string) {
		return `${binding.session}/${id}`
	}
	function release(source: unknown) {
		const binding = bindings.get(source)
		if (binding === undefined) return
		bindings.delete(source)
		for (const id of binding.entries.keys())
			options.registry.remove(key(binding, id))
		options.send(source, {
			type: "push",
			key: "overlaySession",
			data: { resId: binding.resId },
		})
	}
	return {
		bind(source: unknown, resId: string): string {
			const existing = bindings.get(source)
			if (existing?.resId === resId) return existing.session
			release(source)
			// A lifetime identifier, not an authentication credential. Inbound
			// authentication is source-based and works on plain-HTTP LAN hosts.
			const session = `${instance}:${++nextSession}`
			bindings.set(source, { resId, session, revision: -1, entries: new Map() })
			options.send(source, {
				type: "push",
				key: "overlaySession",
				data: { resId, session },
			})
			return session
		},
		sync(source: unknown, resId: string, input: Sync) {
			const binding = bindings.get(source)
			if (
				binding === undefined ||
				binding.resId !== resId ||
				binding.session !== input.session
			)
				return { accepted: false }
			if (input.revision <= binding.revision) return { accepted: true }
			binding.revision = input.revision
			const ids = new Set(input.overlays.map((overlay) => overlay.id))
			for (const id of binding.entries.keys()) {
				if (!ids.has(id)) {
					binding.entries.delete(id)
					options.registry.remove(key(binding, id))
				}
			}
			for (const overlay of input.overlays) {
				const entry = binding.entries.get(overlay.id) ?? { open: true }
				entry.open = true
				binding.entries.set(overlay.id, entry)
				options.registry.set({
					id: key(binding, overlay.id),
					parentId:
						overlay.parentId === undefined
							? undefined
							: key(binding, overlay.parentId),
					isOpen: () => entry.open,
					close() {
						entry.open = false
						options.send(source, {
							type: "push",
							key: "overlayClose",
							data: { session: binding.session, id: overlay.id },
						})
					},
				})
			}
			return { accepted: true }
		},
		release,
		dispose() {
			for (const source of bindings.keys()) release(source)
		},
	}
}

export type OverlayHost = ReturnType<typeof createOverlayHost>
