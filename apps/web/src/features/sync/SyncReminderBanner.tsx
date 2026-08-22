import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { DangerTriangle, RefreshCircle } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { syncSummaryQueryOptions } from "./api"

/**
 * Dashboard reminder banners for the sync-device feature. Shows one
 * banner per device that is due (never synced or past the configured
 * interval), or a permanent warning when no devices are configured. The
 * server computes `due`; this component only renders.
 */
export function SyncReminderBanner() {
	const { t } = useTranslation()
	const summaryQuery = useQuery(syncSummaryQueryOptions())
	const summary = summaryQuery.data

	if (summary === undefined) return null
	if (summary.devices.length === 0) {
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
	const dueDevices = summary.devices.filter((entry) => entry.due)
	if (dueDevices.length === 0) return null
	return (
		<div className="flex flex-col gap-3">
			{dueDevices.map(({ device, latestRecord, elapsedDays }) => {
				const neverSynced = latestRecord === undefined
				return (
					<BannerRow
						key={device.id}
						testId={`sync-warning-due-${device.id}`}
						icon={RefreshCircle}
						title={
							neverSynced
								? t("sync.banner.neverSyncedTitle", { name: device.name })
								: t("sync.banner.overdueTitle", {
										name: device.name,
										count: elapsedDays ?? 0,
									})
						}
						description={
							neverSynced
								? t("sync.banner.neverSyncedDescription")
								: t("sync.banner.overdueDescription", {
										count: summary.remindDays,
									})
						}
						buttonLabel={t("sync.banner.recordLink")}
					/>
				)
			})}
		</div>
	)
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
					<Link to="/settings/sync">
						<Icon icon={RefreshCircle} />
						{buttonLabel}
					</Link>
				}
			/>
		</div>
	)
}
