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
