import { UsersGroupRounded } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { trpcQueryOptions } from "@/trpc/factory"
import { SettingsSection } from "./SettingsSection"

const connectionsKeys = {
	all: ["access", "connections"] as const,
}

function connectionsQueryOptions() {
	return trpcQueryOptions({
		namespace: "access",
		procedure: "connections",
		input: undefined,
		queryKey: connectionsKeys.all,
		staleTime: 30_000,
	})
}

/**
 * Recent sign-in events — device, IP, origin and time. Works identically
 * in the browser and the desktop shell; the data lives only in the local
 * database and rows older than 90 days are pruned by the server.
 */
export function ConnectionsSection() {
	const { t } = useTranslation()
	const formatter = useDateFormatter()
	const query = useQuery(connectionsQueryOptions())
	const connections = query.data?.connections ?? []

	return (
		<SettingsSection
			icon={UsersGroupRounded}
			title={t("me.connections.title")}
			description={t("me.connections.description")}
			layout="stack"
			data-testid="me-connections-section"
		>
			{connections.length === 0 ? (
				<p
					className="text-xs leading-5 text-muted-foreground"
					data-testid="me-connections-empty"
				>
					{t("me.connections.empty")}
				</p>
			) : (
				<ul className="flex flex-col">
					{connections.map((conn) => (
						<li
							key={conn.id}
							className="flex items-center justify-between gap-4 py-1.5"
						>
							<div className="min-w-0">
								<div className="text-ui font-semibold text-foreground">
									{conn.deviceLabel}
									{conn.origin === "loopback" ? (
										<span className="ml-2 text-xs font-normal text-muted-foreground">
											{t("me.connections.loopback")}
										</span>
									) : null}
								</div>
								<p className="truncate text-xs text-muted-foreground">
									{conn.ip}
								</p>
							</div>
							<span className="shrink-0 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
								{formatter.formatDateTime(conn.recordedAt)}
							</span>
						</li>
					))}
				</ul>
			)}
		</SettingsSection>
	)
}
