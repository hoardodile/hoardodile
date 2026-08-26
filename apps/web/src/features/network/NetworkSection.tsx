import { Button } from "@hoardodile/ui/components/button"
import { Global } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { networkInfoQueryOptions, networkTestMutation } from "./networkApi"

/**
 * Read-only outbound network status: which proxy the app resolved (env
 * vars / OS system / explicit `HOARDODILE_PROXY`) and a user-triggered
 * connectivity probe through the exact path the plugin marketplace
 * uses. No configuration is written here — the proxy stays a
 * deployment-level concern.
 */
export function NetworkSection() {
	const { t } = useTranslation()
	const infoQuery = useQuery(networkInfoQueryOptions())
	const testMut = useMutation(networkTestMutation())
	const info = infoQuery.data

	const sourceLabel =
		info === undefined
			? undefined
			: info.source === "none"
				? t("me.network.sourceNone")
				: info.source === "system"
					? t("me.network.sourceSystem")
					: info.source === "explicit"
						? t("me.network.sourceExplicit")
						: t("me.network.sourceEnv")
	const host = info?.httpsHost ?? info?.httpHost
	const proxyActive = host !== null

	const testState =
		testMut.data !== undefined
			? testMut.data.ok
				? {
						ok: true,
						text: t("me.network.testSuccess", { status: testMut.data.status }),
					}
				: {
						ok: false,
						text: t("me.network.testFailed", { message: testMut.data.message }),
					}
			: testMut.error !== null
				? {
						ok: false,
						text: t("me.network.testFailed", {
							message: testMut.error.message,
						}),
					}
				: undefined

	return (
		<SettingsSection
			icon={Global}
			title={t("me.network.title")}
			description={t("me.network.description")}
			layout="stack"
			data-testid="me-network-section"
		>
			<div className="flex flex-col">
				<div className="flex items-start gap-4 py-1.5">
					<span className="w-28 shrink-0 pt-0.5 text-ui font-semibold text-foreground">
						{t("me.network.proxyLabel")}
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"size-1.5 shrink-0 rounded-full",
									proxyActive ? "bg-emerald-500" : "bg-muted",
								)}
								data-testid="network-status-dot-proxy"
								aria-hidden="true"
							/>
							<span
								className="truncate text-sm text-foreground"
								data-testid="network-proxy-value"
							>
								{sourceLabel === undefined
									? t("common.loading")
									: sourceLabel + (proxyActive ? ` · ${host}` : "")}
							</span>
						</div>
						{(info?.bypassCount ?? 0) > 0 && (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{t("me.network.bypassCount", {
									count: info?.bypassCount ?? 0,
								})}
							</p>
						)}
						{!proxyActive && info !== undefined && (
							<p className="mt-0.5 text-xs text-muted-foreground">
								{t("me.network.proxyConfigHint")}
							</p>
						)}
					</div>
				</div>
				<div className="flex items-start gap-4 py-1.5">
					<span className="w-28 shrink-0 pt-0.5 text-ui font-semibold text-foreground">
						{t("me.network.connectionLabel")}
					</span>
					<div className="flex min-w-0 flex-1 items-center gap-2">
						{testState !== undefined ? (
							<>
								<span
									className={cn(
										"size-1.5 shrink-0 rounded-full",
										testState.ok ? "bg-emerald-500" : "bg-destructive",
									)}
									data-testid="network-status-dot-connection"
									aria-hidden="true"
								/>
								<span
									className={cn(
										"truncate text-sm",
										testState.ok ? "text-foreground" : "text-destructive",
									)}
									data-testid="network-test-result"
								>
									{testState.text}
								</span>
							</>
						) : (
							<span className="text-sm text-muted-foreground">
								{t("me.network.notTested")}
							</span>
						)}
						<Button
							variant="secondary"
							size="sm"
							className="ml-auto"
							onClick={() => testMut.mutate()}
							disabled={testMut.isPending}
							data-testid="network-test-button"
						>
							{t(testMut.isPending ? "me.network.testing" : "me.network.test")}
						</Button>
					</div>
				</div>
			</div>
			{testState !== undefined && !testState.ok && (
				<p className="text-xs leading-5 text-muted-foreground">
					{t("me.network.testHint")}
				</p>
			)}
		</SettingsSection>
	)
}
