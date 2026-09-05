/**
 * tRPC procedures whose server handler legitimately runs far longer than
 * a normal round trip. The web client exempts these from its default
 * request-timeout cap and holds them open for the ceiling the SDK
 * declares for the same operation.
 *
 * Keep this list in sync with the procedure definitions in
 * `apps/server/src/domain/**` — currently `pluginAsset.request` (awaits
 * the user's consent decision + the transfer) and
 * `resource.extractArchive` (server-side archive extraction; the router
 * of `apps/server/src/domain/res/import-router.ts` is merged FLAT under
 * `resource`, so the wire path has no `import` segment).
 */
export const LONG_RUNNING_TRPC_PROCEDURES: readonly string[] = [
	"pluginAsset.request",
	"resource.extractArchive",
]

/** File commits can wait behind a full-library backup; users can cancel their queue jobs. */
export const STORAGE_COMMIT_TIMEOUT_MS = 12 * 60 * 60 * 1000
export const STORAGE_COMMIT_TRPC_PROCEDURES: readonly string[] = [
	"resource.create",
	"resource.hardDelete",
	"resource.hardDeleteMany",
	"resource.setContentPluginId",
	"resource.replaceContentPlugin",
	"character.create",
	"character.hardDelete",
	"tag.delete",
	"tag.forceDelete",
	"tag.merge",
	"plugin.rescan",
	"plugin.uninstall",
	"plugin.restoreSeedPlugin",
	"protection.initialize",
	"protection.prepareRestore",
	"protection.prepareRepair",
	"protection.metadata",
	"protection.previewRetention",
	"protection.deletePoint",
]

export function canWaitForStorage(url: string, method = "GET"): boolean {
	const path = new URL(url).pathname
	if (path.startsWith("/api/") && ["PUT", "POST", "DELETE"].includes(method))
		return true
	return (
		path.startsWith("/trpc/") &&
		path
			.slice(6)
			.split(",")
			.some((name) => STORAGE_COMMIT_TRPC_PROCEDURES.includes(name))
	)
}
