import { createOverlayHost } from "@hoardodile/host-web"
import { getMobileBackController } from "@hoardodile/ui/lib/mobile-back-browser"
import { postToIframe } from "./transport"

/** UI registrations and plugin registrations share the top window's controller. */
export const pluginOverlays = createOverlayHost({
	registry: {
		set: (entry) => getMobileBackController().set(entry),
		remove: (id) => getMobileBackController().remove(id),
	},
	send(source, message) {
		// Sources originate in the authenticated iframe registry.
		postToIframe(source as Window, message)
	},
})
