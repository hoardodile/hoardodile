import { createHostRouter, type HostHandlerEntry } from "@hoardodile/host-web"
import { addSubscription, resolvePluginMessageSource } from "./iframe-registry"
import { postToIframe } from "./transport"

/**
 * Creates a `message` event handler that processes requests from sandboxed
 * plugin iframes, assembled on the shared host-core router (routing,
 * param validation, stale-scope dropping, response envelope).
 *
 * Security: origin/source validation is delegated to
 * {@link resolvePluginMessageSource} (origin must be `"null"` since
 * iframes are sandboxed without `allow-same-origin`, and the source must
 * be a registered iframe window).
 */
export function createHostMessageHandler(
	handlers: readonly HostHandlerEntry[],
): (event: MessageEvent) => void {
	return createHostRouter(handlers, {
		resolveSource(event) {
			const resolved = resolvePluginMessageSource(event)
			if (resolved === undefined) return undefined
			const { source, record } = resolved
			return { source, record }
		},
		respond(source, response) {
			postToIframe(source as Window, response)
		},
		subscribe(source, key) {
			addSubscription(source as Window, key)
		},
	})
}
