import type { QueryClient } from "@tanstack/react-query"
import { redirect } from "@tanstack/react-router"
import { authStatusQueryOptions, HttpError } from "./api"
import { isSessionLocked, needsUnlock, unlockDestination } from "./session"

export async function authenticationGuard(
	{ context }: { context: { queryClient: QueryClient } },
	unlocking: boolean,
): Promise<void> {
	// A lock screen must render immediately, including while the server is offline.
	if (unlocking && isSessionLocked() && needsUnlock()) return
	try {
		const status = await context.queryClient.fetchQuery({
			...authStatusQueryOptions(),
			staleTime: 0,
		})
		if (status.authenticated)
			throw redirect({
				href: unlocking ? unlockDestination() : "/",
				replace: true,
			})
		if (!status.configured || !needsUnlock()) {
			if (unlocking) throw redirect({ to: "/login", replace: true })
		} else if (!unlocking) {
			throw redirect({ to: "/unlock", replace: true })
		}
	} catch (error) {
		if (!(error instanceof HttpError)) throw error
	}
}
