import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { sendFile } from "./conditional-request.ts"
import {
	domainErrorToHttp,
	imageFormatContentType,
	parseSafeIdParam,
	sendJson,
} from "./utils.ts"

const charThumbParamsSchema = {
	type: "object",
	properties: {
		id: { type: "string", minLength: 1, maxLength: 255 },
		variant: { type: "string", enum: ["avatar", "fullbody"] },
	},
	required: ["id", "variant"],
} as const

/**
 * Fastify plugin registering `GET /api/characters/:id/thumb/:variant`.
 *
 * Returns the cached preview-size webp for a character avatar or fullbody
 * image, synthesising it on first access. `variant` must be `avatar` or
 * `fullbody`. When the character has no image for the requested variant,
 * the route answers 404 — the client renders its own text tile instead of
 * a placeholder image.
 */
async function charThumbsPluginImpl(app: FastifyInstance): Promise<void> {
	const thumbs = app.thumbService
	const characters = app.charService
	app.get<{ Params: { id: string; variant: string } }>(
		"/api/characters/:id/thumb/:variant",
		{
			schema: { params: charThumbParamsSchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const id = parseSafeIdParam(reply, req.params.id)
			if (id === undefined) return reply
			const variantRaw = req.params.variant
			if (variantRaw !== "avatar" && variantRaw !== "fullbody") {
				return sendJson(reply, 400, {
					error: "variant must be avatar or fullbody",
				})
			}
			let version: number
			try {
				version = await characters.getVariantVersion(id, variantRaw)
			} catch (err) {
				return domainErrorToHttp(reply, err)
			}
			try {
				const result = await thumbs.getCharacterThumb(id, variantRaw, version)
				if (result.kind === "unavailable") {
					return sendJson(reply, 404, { error: "no image" })
				}
				return sendFile(reply, result.path, {
					contentType: imageFormatContentType(result.format),
					cacheControl: "private, max-age=60",
					conditional: { headers: req.headers },
				})
			} catch (err) {
				req.log.error({ err, id }, "character thumb synth failed")
				return sendJson(reply, 500, { error: "thumb synth failed" })
			}
		},
	)
}

export const charThumbsPlugin =
	charThumbsPluginImpl satisfies FastifyPluginAsync
