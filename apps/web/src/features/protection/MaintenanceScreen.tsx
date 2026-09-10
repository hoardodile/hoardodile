import { Button } from "@hoardodile/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { authStatusQueryOptions } from "@/features/auth"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { protectionStatusOptions } from "./api"
import { ProtectionJobs } from "./ProtectionJobs"
import { RecoveryPanel } from "./RecoveryPanel"

export function MaintenanceScreen() {
	const { t } = useTranslation()
	const auth = useQuery(authStatusQueryOptions())
	const status = useQuery({
		...protectionStatusOptions(),
		enabled: auth.data?.authenticated === true,
	})
	const [chooseBackup, setChooseBackup] = useState(false)
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
						<ProtectionJobs restoreOnly />
						{status.data?.maintenanceError && (
							<p role="alert" className="my-3 text-xs">
								{status.data.maintenanceError}
							</p>
						)}
						<div className="mt-5 border-t border-border pt-3">
							<Button
								variant="secondary"
								size="sm"
								aria-expanded={chooseBackup}
								onClick={() => setChooseBackup((open) => !open)}
								data-testid="choose-another-backup"
							>
								{t("protectionUx.chooseAnotherBackup")}
							</Button>
							{chooseBackup && (
								<div className="pt-4">
									<RecoveryPanel restoreOnly />
								</div>
							)}
						</div>
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
