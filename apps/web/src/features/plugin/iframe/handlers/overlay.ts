import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import { pluginOverlays } from "../mobile-overlays"
import { defineHandler } from "./registry"

export function createHandlers() {
	return [
		defineHandler(
			pluginMethods.overlaySync,
			requestSchemas.overlaySync,
			(ctx, input) => pluginOverlays.sync(ctx.source, ctx.resId, input),
		),
	]
}
