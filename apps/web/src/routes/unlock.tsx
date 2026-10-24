import { createFileRoute } from "@tanstack/react-router"
import { AuthenticationScreen } from "@/features/auth/AuthenticationScreen"
import { authenticationGuard } from "@/features/auth/route-guard"

export const Route = createFileRoute("/unlock")({
	beforeLoad: (args) => authenticationGuard(args, true),
	component: UnlockRoute,
})

function UnlockRoute() {
	return <AuthenticationScreen unlocking />
}
