import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { DangerTriangle, RefreshCircle } from "@hoardodile/ui/icons/registry"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { useSyncHealth } from "@/features/protection/syncHealth"

/**
 * Dashboard reminder banners for the backup-sync feature: a permanent
 * warning when no device is connected, or one banner while a connected
 * device is due (never received or past the configured interval). The
 * server computes `receivedAt`; this component only renders.
 */
export function SyncReminderBanner() {
	const { t } = useTranslation()
	const health = useSyncHealth()

	if (!health.loaded) return null
	if (health.count === 0) {
		return (
			<BannerRow
				testId="sync-warning-no-devices"
				icon={DangerTriangle}
				title={t("sync.banner.noDevicesTitle")}
				description={t("sync.banner.noDevicesDescription")}
				buttonLabel={t("sync.banner.configureLink")}
			/>
		)
	}
	if (health.dueConnections.length > 0)
		return (
			<BannerRow
				testId="sync-warning-connections"
				icon={RefreshCircle}
				title={t("replication.healthAttention")}
				description={t("replication.never")}
				buttonLabel={t("sync.banner.configureLink")}
			/>
		)
	return null
}

function BannerRow(props: {
	readonly icon: typeof RefreshCircle
	readonly title: string
	readonly description: string
	readonly buttonLabel: string
	readonly testId: string
}) {
	const { icon, title, description, buttonLabel, testId } = props
	return (
		<div
			className="flex items-center gap-3 rounded-xl bg-destructive/10 px-4 py-3"
			data-testid={testId}
		>
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-destructive">
				<Icon icon={icon} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="text-ui font-medium text-foreground">{title}</div>
				<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
					{description}
				</p>
			</div>
			<Button
				type="button"
				variant="ghost"
				nativeButton={false}
				className="shrink-0"
				render={
					<Link to="/settings/backups">
						<Icon icon={RefreshCircle} />
						{buttonLabel}
					</Link>
				}
			/>
		</div>
	)
}
