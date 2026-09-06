import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { FolderOpen } from "@hoardodile/ui/icons/registry"
import { useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation } from "@/trpc/factory"

export function BackupSetup({
	backupRoot,
	repositoryPath,
	onStarted,
}: {
	backupRoot: string
	repositoryPath: string
	onStarted: () => void
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const [mode, setMode] = useState<"choose" | "new" | "existing">("choose")
	const [key, setKey] = useState("")
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
	return (
		<section className="space-y-4" aria-label={t("protectionUx.setup")}>
			<p className="text-ui font-medium">{t("protectionUx.noBackup")}</p>
			<p className="text-xs text-secondary-foreground">
				{t("protectionUx.setupHelp")}
			</p>
			{mode === "choose" ? (
				<div className="flex flex-wrap gap-2">
					<Button data-testid="setup-new-backup" onClick={() => setMode("new")}>
						{t("protectionUx.start")}
					</Button>
					<Button variant="secondary" onClick={() => setMode("existing")}>
						{t("protectionUx.openExisting")}
					</Button>
				</div>
			) : (
				<>
					<p className="break-all text-xs">
						{t("protection.folder")}:{" "}
						{mode === "existing" ? repositoryPath : backupRoot}
					</p>
					<p className="text-xs text-secondary-foreground">
						{t(
							mode === "new"
								? "protectionUx.firstBackupHelp"
								: "protectionUx.existingHelp",
						)}
					</p>
					{mode === "existing" && (
						<div className="space-y-3">
							<div className="space-y-2">
								<div className="flex flex-wrap items-center gap-3">
									<Button
										variant="secondary"
										onClick={() => fileInputRef.current?.click()}
									>
										<Icon icon={FolderOpen} />
										{t("protectionUx.importKeyFile")}
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
									aria-label={t("protectionUx.importKeyFile")}
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
							</div>
							<Input
								type="password"
								aria-label={t("protection.importKey")}
								placeholder={t("protection.importKey")}
								value={key}
								onChange={(event) => setKey(event.target.value)}
							/>
							{fileError && (
								<p role="alert" className="text-xs">
									{t("protectionUx.keyFileError")}
								</p>
							)}
						</div>
					)}
					<div className="flex gap-2">
						<Button
							data-testid="initialize-backups"
							disabled={
								initialize.isPending || (mode === "existing" && !key.trim())
							}
							onClick={() =>
								initialize.mutate({
									recoveryKey: mode === "existing" ? key.trim() : undefined,
								})
							}
						>
							{initialize.isPending
								? t("common.working")
								: t(
										mode === "new"
											? "protectionUx.enableAndBackup"
											: "protectionUx.openExisting",
									)}
						</Button>
						<Button
							variant="secondary"
							disabled={initialize.isPending}
							onClick={() => setMode("choose")}
						>
							{t("protection.cancel")}
						</Button>
					</div>
				</>
			)}
		</section>
	)
}
