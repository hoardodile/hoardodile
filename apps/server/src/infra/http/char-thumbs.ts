import {
	CHARACTER_AVATAR_MAX_AREA,
	CHARACTER_FULLBODY_MAX_AREA,
} from "@hoardodile/shared"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { registerImageSlotRoutes } from "./image-slots.ts"

/**
 * Fastify plugin registering `GET /api/characters/:id/thumb/:variant`.
 *
 * The route set is the shared image-slot surface
 * ({@link registerImageSlotRoutes}) pinned to the character domain, so
 * this plugin exists purely as a named registration point. When the
 * character has no image for the requested variant, the route answers
 * 404 — the client renders its own text tile instead of a placeholder.
 */
async function charThumbsPluginImpl(app: FastifyInstance): Promise<void> {
	registerImageSlotRoutes(app, {
		subjectKind: "character",
		basePath: "/api/characters",
		slots: ["avatar", "fullbody"],
		errorKind: "character",
		service: app.charService,
		thumbs: app.thumbService,
		routeFamilies: ["thumb"],
		thumbMaxAreaOf: (slot) =>
			slot === "avatar"
				? CHARACTER_AVATAR_MAX_AREA
				: CHARACTER_FULLBODY_MAX_AREA,
	})
}

export const charThumbsPlugin =
	charThumbsPluginImpl satisfies FastifyPluginAsync
