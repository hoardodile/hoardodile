import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Switch } from "@hoardodile/ui/components/switch"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { booleanCodec, numberCodec } from "@/features/prefs"
import { usePrefSync } from "@/hooks/usePrefSync"
import { prefKeys } from "@/lib/keys"
import { DEFAULT_AUTO_LOGOUT_DELAY_MS } from "./useAutoLogout"

/** Options for the "sign out after leaving" delay, in milliseconds. */
export const AUTO_LOGOUT_DELAY_OPTIONS = [
	0, 60_000, 300_000, 900_000, 1_800_000,
] as const

/** Options for the server-side session idle timeout, in seconds. */
export const SESSION_IDLE_TTL_OPTIONS = [
	60 * 60,
	12 * 60 * 60,
	24 * 60 * 60,
	7 * 24 * 60 * 60,
	30 * 24 * 60 * 60,
] as const

/** Default idle timeout: matches the `SESSION_TTL_SECONDS` env default. */
export const DEFAULT_SESSION_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Privacy & security settings: automatic sign-out (unattended switch,
 * sign-out delay, server-side idle timeout). Rendered as a section on the
 * Privacy tab.
 */
export function AutoSignOutControls() {
	const { t } = useTranslation()
	const [autoLogoutEnabled, setAutoLogoutEnabled] = usePrefSync(
		prefKeys.privacyAutoLogoutEnabled,
		false,
		booleanCodec(),
	)
	const [autoLogoutDelayMs, setAutoLogoutDelayMs] = usePrefSync(
		prefKeys.privacyAutoLogoutDelayMs,
		DEFAULT_AUTO_LOGOUT_DELAY_MS,
		numberCodec(),
	)
	const [idleTtlSeconds, setIdleTtlSeconds] = usePrefSync(
		prefKeys.authSessionIdleTimeoutSeconds,
		DEFAULT_SESSION_IDLE_TTL_SECONDS,
		numberCodec(),
	)

	function delayLabel(delayMs: number): string {
		return delayMs === 0
			? t("me.privacy.delay.immediately")
			: t("me.privacy.delay.minutes", {
					count: Math.round(delayMs / 60_000),
				})
	}

	function ttlLabel(ttlSeconds: number): string {
		if (ttlSeconds < 24 * 60 * 60) {
			return t("me.privacy.idleTimeout.hours", {
				count: ttlSeconds / 3600,
			})
		}
		return t("me.privacy.idleTimeout.days", {
			count: ttlSeconds / (24 * 60 * 60),
		})
	}

	return (
		<div className="flex flex-col gap-4">
			<PrivacyRow
				title={t("me.privacy.autoLogout.title")}
				description={t("me.privacy.autoLogout.description")}
				control={
					<Switch
						checked={autoLogoutEnabled}
						onCheckedChange={setAutoLogoutEnabled}
						aria-label={t("me.privacy.autoLogout.title")}
						data-testid="privacy-auto-logout-switch"
					/>
				}
			/>
			<div className="flex items-center justify-between gap-4">
				<span className="text-ui font-semibold text-secondary-foreground">
					{t("me.privacy.delayLabel")}
				</span>
				<DropdownSelect
					value={String(autoLogoutDelayMs)}
					onValueChange={(value) => setAutoLogoutDelayMs(Number(value))}
					options={AUTO_LOGOUT_DELAY_OPTIONS.map((ms) => ({
						value: String(ms),
						label: delayLabel(ms),
					}))}
					placeholder={t("me.privacy.delayLabel")}
					aria-label={t("me.privacy.delayLabel")}
					data-testid="privacy-auto-logout-delay"
				/>
			</div>
			<div className="flex items-center justify-between gap-4">
				<span className="flex min-w-0 flex-col">
					<span className="text-ui font-semibold text-secondary-foreground">
						{t("me.privacy.idleTimeout.label")}
					</span>
					<span className="mt-0.5 text-xs leading-5 text-muted-foreground">
						{t("me.privacy.idleTimeout.description")}
					</span>
				</span>
				<DropdownSelect
					value={String(idleTtlSeconds)}
					onValueChange={(value) => setIdleTtlSeconds(Number(value))}
					options={SESSION_IDLE_TTL_OPTIONS.map((seconds) => ({
						value: String(seconds),
						label: ttlLabel(seconds),
					}))}
					placeholder={t("me.privacy.idleTimeout.label")}
					aria-label={t("me.privacy.idleTimeout.label")}
					data-testid="privacy-idle-timeout"
				/>
			</div>
		</div>
	)
}

/** Privacy preference row — title + muted description left, switch right. */
function PrivacyRow(props: {
	readonly title: string
	readonly description: string
	readonly control: ReactNode
}) {
	const { title, description, control } = props
	return (
		<div className="flex items-center justify-between gap-6">
			<div className="min-w-0">
				<div className="text-ui font-semibold text-foreground">{title}</div>
				<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
					{description}
				</p>
			</div>
			{control}
		</div>
	)
}
