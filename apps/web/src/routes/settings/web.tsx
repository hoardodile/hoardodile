import { createFileRoute, redirect } from "@tanstack/react-router"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { WebSessionControls } from "@/features/settings/WebSessionControls"
import { requireAuth } from "@/lib/auth-guard"
import { isHoardodileDesktop } from "@/lib/desktop"

export const Route = createFileRoute("/settings/web")({
	async beforeLoad(ctx) {
		await requireAuth(ctx)
		if (isHoardodileDesktop()) throw redirect({ to: "/settings/desktop" })
	},
	component: WebSettingsRoute,
})

function WebSettingsRoute() {
	return (
		<SettingsSheet>
			<WebSessionControls />
		</SettingsSheet>
	)
}
