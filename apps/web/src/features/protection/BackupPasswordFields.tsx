import { MIN_PASSWORD_LENGTH } from "@hoardodile/schemas/auth"
import { Input } from "@hoardodile/ui/components/input"
import { useId } from "react"
import { useTranslation } from "react-i18next"

export function validBackupPassword(password: string, confirmation: string) {
	return (
		password.length >= MIN_PASSWORD_LENGTH &&
		password.length <= 4096 &&
		!/[\r\n\0]/.test(password) &&
		password === confirmation
	)
}

export function BackupPasswordFields(props: {
	password: string
	confirmation: string
	onPasswordChange: (value: string) => void
	onConfirmationChange: (value: string) => void
}) {
	const { t } = useTranslation()
	const passwordId = useId()
	const confirmationId = useId()
	return (
		<div className="space-y-3">
			<label htmlFor={passwordId} className="block space-y-2 text-xs">
				<span>{t("backupFolders.password")}</span>
				<Input
					id={passwordId}
					type="password"
					autoComplete="new-password"
					value={props.password}
					onChange={(event) => props.onPasswordChange(event.target.value)}
				/>
			</label>
			<label htmlFor={confirmationId} className="block space-y-2 text-xs">
				<span>{t("backupFolders.confirmPassword")}</span>
				<Input
					id={confirmationId}
					type="password"
					autoComplete="new-password"
					value={props.confirmation}
					onChange={(event) => props.onConfirmationChange(event.target.value)}
				/>
			</label>
			<p className="text-xs text-secondary-foreground">
				{t("backupFolders.passwordHelp", { min: MIN_PASSWORD_LENGTH })}
			</p>
		</div>
	)
}
