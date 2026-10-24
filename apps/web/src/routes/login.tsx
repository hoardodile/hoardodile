import { createFileRoute } from "@tanstack/react-router"
import { AuthenticationScreen } from "@/features/auth/AuthenticationScreen"
import { authenticationGuard } from "@/features/auth/route-guard"

export const Route = createFileRoute("/login")({
	beforeLoad: (args) => authenticationGuard(args, false),
	component: AuthenticationScreen,
})
