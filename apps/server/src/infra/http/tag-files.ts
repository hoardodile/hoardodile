import { TAG_IMAGE_MAX_AREA } from "@hoardodile/shared"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import type { TagService } from "src/domain/tag/service.ts"
import { registerImageSlotRoutes } from "./image-slots.ts"

/**
 * Fastify plugin registering raw-HTTP routes for tag image uploads,
 * deletes, original serving and thumb synthesis:
 *
 *   GET    /api/tags/:id/images/image  -- original tag art (404 when unset)
 *   PUT    /api/tags/:id/images/image  -- upload (octet-stream, X-Filename)
 *   DELETE /api/tags/:id/images/image  -- remove
 *   GET    /api/tags/:id/thumb/image   -- cached preview avif (404 when unset)
 *
 * The route set is the shared image-slot surface
 * ({@link registerImageSlotRoutes}) pinned to the tag domain; the tag
 * service exposes its single slot through the adapter below so the
 * factory stays slot-generic.
 */
async function tagFilesPluginImpl(app: FastifyInstance): Promise<void> {
	const tags = app.tagService as TagService
	registerImageSlotRoutes(app, {
		subjectKind: "tag",
		basePath: "/api/tags",
		slots: ["image"],
		errorKind: "tag",
		service: {
			getVariantVersion: (id) => tags.getImageVersion(id),
			resolveImagePath: (id) => tags.resolveImagePath(id),
			setImage: (id, _slot, ext, sourcePath) =>
				tags.setImage(id, ext, sourcePath),
			clearImage: (id) => tags.clearImage(id),
		},
		thumbs: app.thumbService,
		thumbMaxAreaOf: () => TAG_IMAGE_MAX_AREA,
	})
}

export const tagFilesPlugin = tagFilesPluginImpl satisfies FastifyPluginAsync
