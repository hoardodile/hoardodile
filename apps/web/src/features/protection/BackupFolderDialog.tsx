import type { DesktopBackupSelection } from "@hoardodile/shared/desktop"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { useQueryClient } from "@tanstack/react-query"
import { useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation } from "@/trpc/factory"
import {
	BackupPasswordFields,
	validBackupPassword,
} from "./BackupPasswordFields"

/** Folder selection grants access to one path; opening it never changes the backup destination. */
export function BackupFolderDialog(props: {
	selection: DesktopBackupSelection
	open: boolean
	onOpenChange: (open: boolean) => void
	onSourceOpened: (id: string) => void
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const passwordId = useId()
	const { selection } = props
	const { purpose } = selection
	const [credential, setCredential] = useState("")
	const [password, setPassword] = useState("")
	const [confirmation, setConfirmation] = useState("")
	const [useFile, setUseFile] = useState(false)
	const [fileName, setFileName] = useState("")
	const [error, setError] = useState("")
	const fileInput = useRef<HTMLInputElement>(null)
	function close(open: boolean) {
		if (!open) {
			setCredential("")
			setPassword("")
			setConfirmation("")
			setUseFile(false)
			setFileName("")
			setError("")
		}
		props.onOpenChange(open)
	}
	const openSource = useToastMutation({
		...trpcMutation("protection", "openRestoreSource"),
		resolveError: () => t("backupFolders.openError"),
		onSuccess: async (value) => {
			props.onSourceOpened(value.repositoryId)
			close(false)
			await qc.invalidateQueries({ queryKey: ["protection"] })
		},
	})
	const changeLocation = useToastMutation({
		...trpcMutation("protection", "setBackupLocation"),
		resolveError: () => t("backupFolders.changeError"),
		onSuccess: async () => {
			close(false)
			await qc.invalidateQueries({ queryKey: ["protection"] })
		},
	})
	const pending = openSource.isPending || changeLocation.isPending
	const creating = !selection.exists
	return (
		<AppDialog
			open={props.open}
			onOpenChange={(open) => {
				if (!pending) close(open)
			}}
			title={t(
				purpose === "restore"
					? "backupFolders.restoreFromFolder"
					: "backupFolders.changeLocation",
			)}
			footer={
				<>
					<Button
						variant="secondary"
						disabled={pending}
						onClick={() => close(false)}
					>
						{t("common.cancel")}
					</Button>
					<Button
						data-testid="backup-folder-submit"
						disabled={
							pending ||
							(creating
								? !validBackupPassword(password, confirmation)
								: !credential)
						}
						onClick={() => {
							if (purpose === "restore")
								openSource.mutate({
									selectionId: selection.id,
									credential,
									credentialType: useFile ? "key" : "password",
								})
							else
								changeLocation.mutate({
									selectionId: selection.id,
									credential: selection.exists ? credential : undefined,
									credentialType: useFile ? "key" : "password",
									password: creating ? password : undefined,
								})
						}}
					>
						{pending
							? t("common.working")
							: t(
									purpose === "restore"
										? "backupFolders.openSource"
										: creating
											? "backupFolders.createAndUse"
											: "backupFolders.useLocation",
								)}
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				<p className="text-xs text-secondary-foreground">
					{t(
						purpose === "restore"
							? "backupFolders.restoreHelp"
							: "backupFolders.locationHelp",
					)}
				</p>
				<p className="break-all text-ui" data-testid="selected-backup-folder">
					{selection.path}
				</p>
				{creating && (
					<BackupPasswordFields
						password={password}
						confirmation={confirmation}
						onPasswordChange={setPassword}
						onConfirmationChange={setConfirmation}
					/>
				)}
				{selection.exists && (
					<div className="space-y-3">
						<Button
							variant="ghost"
							size="sm"
							disabled={pending}
							onClick={() => {
								setUseFile(!useFile)
								setCredential("")
								setFileName("")
								setError("")
							}}
						>
							{t(
								useFile
									? "backupFolders.usePassword"
									: "backupFolders.useKeyFile",
							)}
						</Button>
						{useFile ? (
							<>
								<Button
									variant="secondary"
									disabled={pending}
									onClick={() => fileInput.current?.click()}
								>
									{t("backupSetup.chooseKey")}
								</Button>
								<input
									ref={fileInput}
									type="file"
									accept=".json,application/json"
									aria-label={t("backupSetup.chooseKey")}
									className="sr-only"
									onChange={(event) => {
										const file = event.target.files?.[0]
										setCredential("")
										setFileName("")
										setError("")
										if (!file) return
										if (file.size > 64 * 1024) {
											setError(t("backupSetup.keyFileError"))
											return
										}
										void file
											.text()
											.then((value) => {
												const parsed: unknown = JSON.parse(value)
												if (
													!parsed ||
													typeof parsed !== "object" ||
													!("format" in parsed) ||
													parsed.format !== "hoardodile-restic-v1" ||
													!("key" in parsed) ||
													typeof parsed.key !== "string" ||
													!parsed.key ||
													parsed.key.length > 4096
												)
													throw new Error("Invalid recovery key")
												setCredential(
													JSON.stringify({
														format: parsed.format,
														key: parsed.key,
													}),
												)
												setFileName(file.name)
											})
											.catch(() => setError(t("backupSetup.keyFileError")))
									}}
								/>
								{fileName && (
									<p className="text-xs text-muted-foreground">{fileName}</p>
								)}
							</>
						) : (
							<label htmlFor={passwordId} className="block space-y-2 text-xs">
								<span>{t("backupFolders.password")}</span>
								<Input
									id={passwordId}
									type="password"
									autoComplete="off"
									value={credential}
									onChange={(event) => setCredential(event.target.value)}
								/>
							</label>
						)}
					</div>
				)}
				{error && (
					<p role="alert" className="text-xs">
						{error}
					</p>
				)}
			</div>
		</AppDialog>
	)
}
