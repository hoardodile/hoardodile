import { Switch } from "@hoardodile/ui/components/switch"
import { LockPassword } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import { useWebAuthPreference, webAuthKeys } from "@/features/auth/session"
import { SettingsSection } from "./SettingsSection"

export function WebSessionControls() {
	const { t } = useTranslation()
	const [requireUnlock, setRequireUnlock] = useWebAuthPreference(
		webAuthKeys.requireUnlock,
	)
	const [autoLock, setAutoLock] = useWebAuthPreference(webAuthKeys.autoLock)
	return (
		<SettingsSection
			icon={LockPassword}
			title={t("me.web.title")}
			description={t("me.web.description")}
			layout="stack"
			data-testid="web-session-section"
		>
			<div className="flex flex-col gap-6">
				{(
					[
						{
							key: "requireUnlock",
							checked: requireUnlock,
							change: setRequireUnlock,
						},
						{ key: "autoLock", checked: autoLock, change: setAutoLock },
					] as const
				).map((setting) => (
					<div
						key={setting.key}
						className="flex items-center justify-between gap-6"
					>
						<div className="min-w-0">
							<div className="text-ui font-semibold text-foreground">
								{t(`me.web.${setting.key}.title`)}
							</div>
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								{t(`me.web.${setting.key}.description`)}
							</p>
						</div>
						<Switch
							checked={setting.checked}
							onCheckedChange={setting.change}
							aria-label={t(`me.web.${setting.key}.title`)}
							data-testid={`web-${setting.key}-switch`}
						/>
					</div>
				))}
			</div>
		</SettingsSection>
	)
}
