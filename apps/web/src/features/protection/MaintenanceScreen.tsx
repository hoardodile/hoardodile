import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { authStatusQueryOptions } from "@/features/auth"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { RecoveryPanel } from "./RecoveryPanel"

export function MaintenanceScreen() {
	const { t } = useTranslation()
	const auth = useQuery(authStatusQueryOptions())
	return (
		<main className="h-svh overflow-auto p-8" data-testid="library-maintenance">
			<div className="mx-auto max-w-4xl space-y-5">
				<header>
					<h1 className="text-xl font-medium">{t("protection.maintenance")}</h1>
					<p className="mt-2 text-sm text-secondary-foreground">
						{t("protection.maintenanceHelp")}
					</p>
				</header>
				{auth.data?.authenticated ? (
					<SettingsSheet>
						<RecoveryPanel />
					</SettingsSheet>
				) : (
					<Link to="/login" className="text-sm underline">
						{t("auth.login.title")}
					</Link>
				)}
			</div>
		</main>
	)
}
