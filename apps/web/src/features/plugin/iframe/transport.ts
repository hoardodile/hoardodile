import type {
	HostPush,
	HostResponse,
	PluginIframeContext,
} from "@hoardodile/sdk-web"
import { hostPushKeys } from "@hoardodile/sdk-web"

// Transport: wraps one iframe element with typed push/setVisibility/dispose,
// and owns the layer's single postMessage exit point.

/**
 * The iframe layer's only `postMessage(msg, "*")` exit point. The "*"
 * targetOrigin is deliberate and unchanged: sandboxed plugin iframes have
 * the opaque origin "null", and inbound messages are authenticated by
 * origin/source validation (see `resolvePluginMessageSource` in
 * iframe-registry.ts).
 */
export function postToIframe(
	source: Window,
	msg: HostPush | HostResponse,
): void {
	source.postMessage(msg, "*")
}

export type PluginIframeTransport = {
	readonly pushContext: (ctx: PluginIframeContext) => void
	readonly setVisibility: (visible: boolean) => void
	readonly push: (key: string, data?: unknown) => void
	readonly dispose: () => void
}

export function createTransport(
	iframe: HTMLIFrameElement,
): PluginIframeTransport {
	let disposed = false

	function post(msg: HostPush): void {
		const win = iframe.contentWindow
		if (win === null) return
		postToIframe(win, msg)
	}

	return {
		pushContext(ctx) {
			if (disposed) return
			post({ type: "push", key: hostPushKeys.context, data: ctx })
		},
		setVisibility(visible) {
			if (disposed) return
			post({ type: "push", key: hostPushKeys.visibility, data: { visible } })
		},
		push(key, data) {
			if (disposed) return
			post({ type: "push", key, data })
		},
		dispose() {
			disposed = true
		},
	}
}
