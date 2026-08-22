import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import { patchSharedFolderRoot } from "src/config/env.ts"
import { authorizeSidecarToken } from "src/infra/http/internal-token.ts"
import "src/infra/fastify-augment.ts"

/**
 * Token-gated live patch of `SHARED_FOLDER_ROOT` for the desktop sidecar.
 * Folder import reads `ctx.env` per request, so the next browse uses the
 * new root without restarting Fastify.
 *
 * Wrong or missing token: 401. Relative, empty, or missing `path`: 400.
 * `path: null` clears the root and disables shared-folder import.
 */
async function sharedFolderPluginImpl(app: FastifyInstance): Promise<void> {
	app.post("/api/internal/shared-folder", async (request, reply) => {
		if (!authorizeSidecarToken(app, request)) {
			return reply.code(401).send({ ok: false as const })
		}
		const patch = readPatch(request.body)
		if (patch === undefined) {
			return reply.code(400).send({ ok: false as const })
		}
		try {
			if (patch.kind === "clear") {
				patchSharedFolderRoot(app.env, undefined)
			} else {
				patchSharedFolderRoot(app.env, patch.path)
			}
		} catch {
			return reply.code(400).send({ ok: false as const })
		}
		return { ok: true as const }
	})
}

type SharedFolderPatch =
	| { readonly kind: "set"; readonly path: string }
	| { readonly kind: "clear" }

function readPatch(body: unknown): SharedFolderPatch | undefined {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return undefined
	}
	if (!("path" in body)) return undefined
	if (body.path === null) return { kind: "clear" }
	if (typeof body.path !== "string" || body.path.length === 0) return undefined
	return { kind: "set", path: body.path }
}

export const sharedFolderPlugin = fp(
	sharedFolderPluginImpl satisfies FastifyPluginAsync,
	{
		name: "shared-folder-plugin",
		dependencies: ["env-plugin"],
	},
)
