import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
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
	const [fileError, setFileError] = useState(false)
	const initialize = useToastMutation({
		...trpcMutation("protection", "initialize"),
		onSuccess: async () => {
			onStarted()
			await qc.invalidateQueries({ queryKey: ["protection"] })
		},
	})
	return (
		<section
			className="space-y-4 rounded-lg bg-muted p-5"
			aria-label={t("protectionUx.setup")}
		>
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
							<label
								htmlFor="recovery-key-file"
								className="block space-y-2 text-xs"
							>
								<span>{t("protectionUx.importKeyFile")}</span>
								<Input
									id="recovery-key-file"
									type="file"
									accept=".json,application/json"
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
												setFileError(false)
											})
											.catch(() => setFileError(true))
									}}
								/>
							</label>
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
							variant="ghost"
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
