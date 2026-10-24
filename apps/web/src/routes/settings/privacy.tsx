import { createFileRoute, redirect } from "@tanstack/react-router"
import { requireAuth } from "@/lib/auth-guard"
import { isHoardodileDesktop } from "@/lib/desktop"

/** Compatibility for bookmarks made before the Web settings tab. */
export const Route = createFileRoute("/settings/privacy")({
	async beforeLoad(ctx) {
		await requireAuth(ctx)
		throw redirect({
			to: isHoardodileDesktop() ? "/settings/desktop" : "/settings/web",
			replace: true,
		})
	},
})
