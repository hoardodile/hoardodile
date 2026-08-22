import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { z } from "zod"
import { defineHandler, type HostHandlerEntry } from "./registry"

const schema = z.object({
	message: z.string().optional(),
	data: z.any().optional(),
})

export function createHandlers(_qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(pluginMethods.logInfo, schema, async (_ctx, _params) => {
			// no-op
		}),
		defineHandler(pluginMethods.logWarn, schema, async (_ctx, _params) => {
			// no-op
		}),
		defineHandler(pluginMethods.logError, schema, async (_ctx, _params) => {
			// no-op
		}),
	]
}
