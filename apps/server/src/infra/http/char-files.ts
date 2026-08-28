import {
	CHARACTER_AVATAR_MAX_AREA,
	CHARACTER_FULLBODY_MAX_AREA,
} from "@hoardodile/shared"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { registerImageSlotRoutes } from "./image-slots.ts"

/**
 * Fastify plugin registering raw-HTTP routes for character image uploads,
 * deletes and thumbs. The route set is the shared image-slot surface
 * ({@link registerImageSlotRoutes}) pinned to the character domain:
 *
 *   GET    /api/characters/:id/images/:variant  -- original avatar/fullbody
 *   PUT    /api/characters/:id/images/:variant  -- upload avatar or fullbody
 *   DELETE /api/characters/:id/images/:variant  -- remove
 *   GET    /api/characters/:id/thumb/:variant   -- cached preview avif
 *
 * `variant` must be `avatar` or `fullbody`. The upload body must be
 * `application/octet-stream`; the filename (and thus extension) is taken
 * from the `X-Filename` request header so the route URL stays clean.
 *
 * The actual file writes are delegated to `charService.setImage` /
 * `charService.clearImage`, which route through `writeVersioned` so the
 * bytes always land under `paths.latest` and the read-only archive gate
 * is respected. The HTTP layer only validates transport concerns and
 * streams the body into a temporary file.
 */
async function charFilesPluginImpl(app: FastifyInstance): Promise<void> {
	registerImageSlotRoutes(app, {
		subjectKind: "character",
		basePath: "/api/characters",
		slots: ["avatar", "fullbody"],
		errorKind: "character",
		service: app.charService,
		thumbs: app.thumbService,
		routeFamilies: ["images"],
		thumbMaxAreaOf: (slot) =>
			slot === "avatar"
				? CHARACTER_AVATAR_MAX_AREA
				: CHARACTER_FULLBODY_MAX_AREA,
	})
}

export const charFilesPlugin = charFilesPluginImpl satisfies FastifyPluginAsync
