import { redirect } from "@tanstack/react-router"
import { authStatusQueryOptions, HttpError } from "@/features/auth"
import {
	isSessionLocked,
	lockSession,
	needsUnlock,
} from "@/features/auth/session"

type BeforeLoadContext = {
	context: { queryClient: import("@tanstack/react-query").QueryClient }
	location?: { href: string }
}

/**
 * TanStack Router `beforeLoad` guard. Redirect unauthenticated visitors to
 * `/login`. Import and assign directly:
 *
 * ```ts
 * export const Route = createFileRoute("/resources/")({
 *   beforeLoad: requireAuth,
 *   component: MyPage,
 * })
 * ```
 */
export async function requireAuth({
	context,
	location,
}: BeforeLoadContext): Promise<void> {
	try {
		const status = await context.queryClient.ensureQueryData(
			authStatusQueryOptions(),
		)
		if (!status.authenticated || isSessionLocked()) {
			if (status.configured && needsUnlock()) {
				lockSession(
					location?.href ??
						window.location.pathname +
							window.location.search +
							window.location.hash,
				)
				throw redirect({ to: "/unlock", replace: true })
			}
			throw redirect({ to: "/login", replace: true })
		}
	} catch (err) {
		if (err instanceof HttpError && err.status === 401) {
			throw redirect({
				to: needsUnlock() ? "/unlock" : "/login",
				replace: true,
			})
		}
		throw err
	}
}
