import { redirect } from "@tanstack/react-router"
import { authStatusQueryOptions, HttpError } from "@/features/auth"

type BeforeLoadContext = {
	context: { queryClient: import("@tanstack/react-query").QueryClient }
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
}: BeforeLoadContext): Promise<void> {
	try {
		const status = await context.queryClient.ensureQueryData(
			authStatusQueryOptions(),
		)
		if (!status.authenticated) {
			throw redirect({ to: "/login" })
		}
	} catch (err) {
		if (err instanceof HttpError && err.status === 401) {
			throw redirect({ to: "/login" })
		}
		throw err
	}
}
