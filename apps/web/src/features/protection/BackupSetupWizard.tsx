import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { FolderOpen } from "@hoardodile/ui/icons/registry"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { isHoardodileDesktop } from "@/lib/desktop"
import { trpcMutation } from "@/trpc/factory"
import { protectionStatusOptions } from "./api"
import {
	BackupPasswordFields,
	validBackupPassword,
} from "./BackupPasswordFields"

type SetupMode = "new" | "existing"

/**
 * Single-layer backup-setup dialog. The choice ("start protecting this
 * device" vs "open an existing backup") lives inline in the Backups section
 * as two big buttons; clicking one opens this dialog for that mode directly —
 * no nested chooser layer and no back button. Desktop backups require a
 * reusable password; fixed-folder recovery remains available to browsers.
 */
export function BackupSetupWizard({
	open,
	onOpenChange,
	onStarted,
	mode,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	onStarted: () => void
	mode: SetupMode
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const [key, setKey] = useState("")
	const [password, setPassword] = useState("")
	const [confirmation, setConfirmation] = useState("")
	const desktop = isHoardodileDesktop()
	const [fileName, setFileName] = useState("")
	const [fileError, setFileError] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const initialize = useToastMutation({
		...trpcMutation("protection", "initialize"),
		onSuccess: async () => {
			onStarted()
			await qc.invalidateQueries({ queryKey: ["protection"] })
		},
	})

	function close(open: boolean) {
		if (!open) {
			setKey("")
			setPassword("")
			setConfirmation("")
			setFileName("")
			setFileError(false)
		}
		onOpenChange(open)
	}

	const folder =
		mode === "existing"
			? (status.data?.localRepositoryPath ?? "")
			: (status.data?.localRepositoryPath ?? status.data?.backupRoot ?? "")

	return (
		<AppDialog
			open={open}
			onOpenChange={close}
			title={t("backupSetup.title")}
			footer={
				<>
					<Button
						variant="secondary"
						disabled={initialize.isPending}
						onClick={() => close(false)}
					>
						{t("backupSetup.cancel")}
					</Button>
					<Button
						data-testid="initialize-backups"
						disabled={
							initialize.isPending ||
							(mode === "existing" && !key.trim()) ||
							(desktop &&
								mode === "new" &&
								!validBackupPassword(password, confirmation))
						}
						onClick={() =>
							initialize.mutate({
								recoveryKey: mode === "existing" ? key.trim() : undefined,
								...(desktop && mode === "new" ? { password } : {}),
							})
						}
					>
						{initialize.isPending
							? t("common.working")
							: mode === "new"
								? t("backupSetup.createFirst")
								: t("protectionUx.openExisting")}
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				<p className="break-all text-xs">
					{t("protection.folder")}: {folder}
				</p>
				{mode === "new" ? (
					<>
						<p className="text-xs text-secondary-foreground">
							{t("backupSetup.createFirstHelp")}
						</p>
						{desktop && (
							<BackupPasswordFields
								password={password}
								confirmation={confirmation}
								onPasswordChange={setPassword}
								onConfirmationChange={setConfirmation}
							/>
						)}
					</>
				) : (
					<>
						<p className="text-xs text-secondary-foreground">
							{t("backupSetup.existingHelp")}
						</p>
						<div className="space-y-2">
							<div className="flex flex-wrap items-center gap-3">
								<Button
									variant="secondary"
									onClick={() => fileInputRef.current?.click()}
								>
									<Icon icon={FolderOpen} />
									{t("backupSetup.chooseKey")}
								</Button>
								{fileName && (
									<span
										className="text-xs text-muted-foreground"
										data-testid="recovery-key-file-name"
									>
										{fileName}
									</span>
								)}
							</div>
							<input
								ref={fileInputRef}
								id="recovery-key-file"
								type="file"
								accept=".json,application/json"
								aria-label={t("backupSetup.chooseKey")}
								className="sr-only"
								onChange={(event) => {
									const file = event.target.files?.[0]
									if (!file) return
									if (file.size > 64 * 1024) {
										setFileError(true)
										return
									}
									void file
										.text()
										.then((value) => {
											setKey(value)
											setFileName(file.name)
											setFileError(false)
										})
										.catch(() => setFileError(true))
								}}
							/>
							<Input
								type="password"
								aria-label={t("protection.importKey")}
								placeholder={t("protection.importKey")}
								value={key}
								onChange={(event) => setKey(event.target.value)}
							/>
							{fileError && (
								<p role="alert" className="text-xs">
									{t("backupSetup.keyFileError")}
								</p>
							)}
						</div>
					</>
				)}
			</div>
		</AppDialog>
	)
}
