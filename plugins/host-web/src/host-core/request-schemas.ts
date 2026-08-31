import { PLUGIN_ASSET_BATCH_MAX_ITEMS } from "@hoardodile/sdk-types/plugin-asset-limits"
import { anchorData as anchorDataSchema } from "@hoardodile/sdk-types/schema"
import type { PluginRequests } from "@hoardodile/sdk-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import { z } from "zod"

/**
 * Wire-level param schemas for every request method, shared by the real
 * host (apps/web) and the offline mock host. Both hosts validate
 * identical shapes, so a plugin that passes validation in the mock is
 * guaranteed to pass in production.
 */

/**
 * Wire shape of a message/danmaku anchor: the plugin location payload
 * only. The resource id is host state — the host stamps its own binding
 * into the anchor before it reaches the server.
 */
export const anchorData = anchorDataSchema

/** One download request (a batch is an array of these). */
const downloadItem = z.object({
	url: z.string().min(1).max(2048),
	dest: z.string().min(1).max(256),
	sha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.optional(),
	reason: z.string().max(200).optional(),
})

export const requestSchemas = {
	[pluginMethods.readFile]: z.object({
		path: z.string().min(1),
		range: z
			.object({
				start: z.number().int().nonnegative().optional(),
				end: z.number().int().nonnegative().optional(),
			})
			.optional(),
	}),
	[pluginMethods.listFiles]: undefined,
	[pluginMethods.listMessages]: undefined,
	[pluginMethods.createMessage]: z.object({
		body: z.string().min(1),
		anchor: anchorData.optional(),
	}),
	[pluginMethods.listDanmaku]: z.object({
		// Filter keys are plugin-defined vocabulary; matching is generic
		// strict equality against the anchor's data.
		filter: z
			.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
			.optional(),
	}),
	[pluginMethods.createDanmaku]: z.object({
		text: z.string().min(1),
		anchor: anchorData,
		mode: z.string().optional(),
	}),
	[pluginMethods.setPref]: z.object({
		key: z.string().min(1),
		value: z.string(),
	}),
	[pluginMethods.setCache]: z.object({
		key: z.string().min(1),
		value: z.string(),
	}),
	[pluginMethods.invalidate]: z.object({
		target: z.enum(["resource", "resources", "messages", "danmaku"]),
	}),
	// The URL is length-capped but not URI-validated here: the host parses
	// it server-side and answers with a machine-readable POLICY error. A
	// single request or a batch (one consent dialog listing every item,
	// all-or-nothing) — capped so a burst cannot stack unbounded tickets.
	[pluginMethods.download]: z.union([
		downloadItem,
		z.array(downloadItem).min(1).max(PLUGIN_ASSET_BATCH_MAX_ITEMS),
	]),
	[pluginMethods.deleteAsset]: z.object({
		path: z.string().min(1).max(256),
	}),
	// The file travels as a Blob/ArrayBuffer via PostMessage structured
	// clone; validation only checks the byte container + filename shape.
	// The extension is verified server-side against IMAGE_EXTS.
	[pluginMethods.uploadCover]: z.object({
		file: z.union([z.instanceof(Blob), z.instanceof(ArrayBuffer)]),
		filename: z.string().min(1).max(255),
		mimeType: z.string().max(255).optional(),
	}),
	[pluginMethods.logInfo]: z.object({
		message: z.string(),
		data: z.record(z.string(), z.unknown()).optional(),
	}),
	[pluginMethods.logWarn]: z.object({
		message: z.string(),
		data: z.record(z.string(), z.unknown()).optional(),
	}),
	[pluginMethods.logError]: z.object({
		message: z.string(),
		data: z.record(z.string(), z.unknown()).optional(),
	}),
} satisfies Record<keyof PluginRequests, z.ZodTypeAny | undefined>
