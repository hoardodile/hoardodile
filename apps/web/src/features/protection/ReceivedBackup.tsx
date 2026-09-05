import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { protectionStatusOptions, recoveryPointsOptions } from "./api"
import { RestoreBackupButton } from "./RestoreBackupButton"

export function ReceivedBackup({
	source,
}: {
	source: { id: string; name: string; receivedAt: number | null }
}) {
	const { t } = useTranslation()
	const status = useQuery(protectionStatusOptions())
	const configured =
		status.data?.repositories.some((repo) => repo.id === source.id) ?? false
	const points = useQuery({
		...recoveryPointsOptions(source.id),
		enabled: configured,
	})
	const latest = points.data?.toSorted((a, b) => b.createdAt - a.createdAt)[0]
	const restored = status.data?.lastRestore
	return (
		<section
			className="space-y-3 rounded-lg bg-muted p-4"
			aria-label={t("replicationUx.receivedBackup")}
		>
			<p className="text-ui font-medium">{t("replicationUx.receivedBackup")}</p>
			{points.error ? (
				<p role="alert">{points.error.message}</p>
			) : latest ? (
				<>
					<p className="text-xs">
						{t("replicationUx.receivedFrom", {
							source: source.name,
							time: new Date(latest.createdAt).toLocaleString(),
						})}
					</p>
					<p className="text-xs text-secondary-foreground">
						{t("replicationUx.libraryUnchanged")}
					</p>
					<RestoreBackupButton
						repositoryId={source.id}
						pointId={latest.id}
						source={source.name}
						received
					/>
				</>
			) : (
				<p className="text-xs">{t("replicationUx.waitingFirst")}</p>
			)}
			{restored?.repositoryId === source.id && (
				<p className="text-xs text-muted-foreground">
					{t("protection.lastRestore")}:{" "}
					{new Date(restored.restoredAt).toLocaleString()} ·{" "}
					{t("protection.restoredEditable")}
				</p>
			)}
		</section>
	)
}
