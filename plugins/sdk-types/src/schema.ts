/**
 * The zod schema layer of the plugin contract: the manifest schema and
 * the wire anchor envelope. Import this subpath
 * (`@hoardodile/sdk-types/schema`) only where a runtime validator is
 * actually needed — the host, the server, and tooling. The root entry
 * re-exports the inferred types only, so plugin bundles never pull zod.
 */
import { z } from "zod"

export * from "./manifest.ts"

/**
 * Wire/storage envelope for a message or danmaku anchor. Carries only
 * the plugin-defined location payload in `data`; the host never
 * interprets its contents. The anchor's resource is host state — the SDK
 * injects it from the iframe's binding and the server derives it from
 * the row's `anchor_resource_id` column — so plugins never see a resId
 * here, and a plugin that sends one is rejected (strict).
 *
 * Plugin code works with the raw location data (`PluginSchema["anchor"]`)
 * directly; the SDK wraps it into this envelope when it crosses the
 * wire.
 */
export const anchorData = z
	.object({
		data: z.unknown().optional(),
	})
	.strict()
export type AnchorData = z.infer<typeof anchorData>
