import type { DesktopBackupSelection } from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { PaginationBar } from "@hoardodile/ui/components/pagination-bar"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Switch } from "@hoardodile/ui/components/switch"
import { Database, History, Server } from "@hoardodile/ui/icons/registry"
import { pageCountOf } from "@hoardodile/ui/lib/pagination"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
	Fragment,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SectionDivider } from "@/features/settings/SettingsSheet"
import { useToastMutation } from "@/hooks/useToastMutation"
import { getDesktopBridge, isHoardodileDesktop } from "@/lib/desktop"
import { trpcMutation } from "@/trpc/factory"
import {
	downloadRecoveryKey,
	protectionJobsOptions,
	protectionStatusOptions,
	recoveryPointsOptions,
} from "./api"
import { BackupFolderDialog } from "./BackupFolderDialog"
import { BackupManagement } from "./BackupManagement"
import { BackupSetupWizard } from "./BackupSetupWizard"
import { BackupStatusHeader } from "./BackupStatusHeader"
import { RecentOperationsDialog } from "./RecentOperationsDialog"
import { RecoveryPointCard } from "./RecoveryPointCard"

const RECOVERY_POINTS_PAGE_SIZE = 20
const FREQUENCIES = [
	{ hours: 1, label: "protectionUx.frequencyHourly" },
	{ hours: 6, label: "protectionUx.frequency6Hours" },
	{ hours: 12, label: "protectionUx.frequency12Hours" },
	{ hours: 24, label: "protectionUx.frequencyDaily" },
	{ hours: 168, label: "protectionUx.frequencyWeekly" },
] as const

function wasKeyDownloaded(key: string | undefined) {
	try {
		return key ? localStorage.getItem(key) === "true" : false
	} catch {
		return false
	}
}

function BackupsSkeleton() {
	return (
		<div className="space-y-6" data-testid="backups-skeleton" aria-hidden>
			<div className="flex items-center gap-3">
				<Skeleton className="size-8 rounded-lg" />
				<div className="min-w-0 space-y-2">
					<Skeleton className="h-4 w-40" />
					<Skeleton className="h-3 w-48 max-w-full" />
				</div>
			</div>
			{[0, 1, 2, 3].map((row) => (
				<div key={row} className="flex items-center justify-between gap-4">
					<Skeleton className="h-10 w-1/2" />
					<Skeleton className="h-8 w-20" />
				</div>
			))}
		</div>
	)
}

/** Backup preferences, recovery sources and upkeep share the settings sheet. */
export function RecoveryPanel({
	restoreOnly = false,
}: {
	restoreOnly?: boolean
} = {}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const status = useQuery(protectionStatusOptions())
	const [selectedRepository, setSelectedRepository] = useState("local")
	const [folderSelection, setFolderSelection] =
		useState<DesktopBackupSelection>()
	const [picking, setPicking] = useState(false)
	const pickingRef = useRef(false)
	const [folderError, setFolderError] = useState<"restore" | "backup" | null>(
		null,
	)
	const desktop =
		isHoardodileDesktop() && Boolean(getDesktopBridge()?.pickBackupFolder)
	const [savedKey, setSavedKey] = useState<string>()
	const [wizardMode, setWizardMode] = useState<"new" | "existing" | null>(null)
	const [operationsOpen, setOperationsOpen] = useState(false)
	const [pointsPage, setPointsPage] = useState(1)
	const repositories = status.data?.repositories ?? []
	const repository =
		repositories.find((repo) => repo.id === selectedRepository) ??
		repositories[0]
	const repositoryId = repository?.id ?? "local"
	const localConfigured = repositories.some((repo) => repo.id === "local")
	const points = useQuery({
		...recoveryPointsOptions(repositoryId),
		enabled: Boolean(repository),
	})
	const sortedPoints = useMemo(
		() => points.data?.toSorted((a, b) => b.createdAt - a.createdAt) ?? [],
		[points.data],
	)
	const pointsPageCount = pageCountOf(
		sortedPoints.length,
		RECOVERY_POINTS_PAGE_SIZE,
	)
	const currentPointsPage = Math.min(pointsPage, pointsPageCount)
	const visiblePoints = sortedPoints.slice(
		(currentPointsPage - 1) * RECOVERY_POINTS_PAGE_SIZE,
		currentPointsPage * RECOVERY_POINTS_PAGE_SIZE,
	)
	useEffect(() => {
		setPointsPage(1)
	}, [repositoryId])
	const jobs = useQuery(protectionJobsOptions())
	const hasJobs = Boolean(jobs.data?.length)
	const maintenance = Boolean(
		status.data?.maintenance ||
			status.data?.maintenanceActive ||
			status.data?.maintenanceError,
	)
	const storageBusy =
		maintenance ||
		Boolean(status.data?.nativeProcessesBusy || status.data?.storage.frozen) ||
		Boolean(
			jobs.data?.some((job) =>
				["queued", "running", "cancelling"].includes(job.state),
			),
		)
	const offline = status.data?.backupAvailable === false
	const keyStorage = status.data
		? `hoardodile.recovery-key.${status.data.instanceId}`
		: undefined
	const keySaved = savedKey === keyStorage || wasKeyDownloaded(keyStorage)
	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const releaseSource = useToastMutation({
		...trpcMutation("protection", "closeRestoreSource"),
		onSuccess: invalidate,
	})
	function selectRepository(id: string) {
		if (repository?.restoreOnly && repository.id !== id)
			releaseSource.mutate({ repositoryId: repository.id })
		setSelectedRepository(id)
	}
	async function chooseFolder(purpose: "restore" | "backup") {
		if (pickingRef.current) return
		pickingRef.current = true
		setPicking(true)
		setFolderError(null)
		try {
			const selection = await getDesktopBridge()?.pickBackupFolder?.(purpose)
			if (selection) setFolderSelection(selection)
		} catch {
			setFolderError(purpose)
		} finally {
			pickingRef.current = false
			setPicking(false)
		}
	}
	const enabled = useToastMutation({
		...trpcMutation("protection", "enabled"),
		onSuccess: invalidate,
	})
	const interval = useToastMutation({
		...trpcMutation("protection", "interval"),
		onSuccess: invalidate,
	})
	const key = useToastMutation({
		...trpcMutation("protection", "recoveryKey"),
		onSuccess: (value) => {
			downloadRecoveryKey(value, value.repositoryId)
			if (keyStorage) {
				try {
					localStorage.setItem(keyStorage, "true")
				} catch {}
			}
			setSavedKey(keyStorage)
		},
	})
	const sourceName =
		repositoryId === "local"
			? t("protectionUx.localBackups")
			: (repository?.name ?? repositoryId)
	const sourceOnly = Boolean(repository?.restoreOnly)
	const sections: { key: string; content: ReactNode }[] = []
	if (!restoreOnly)
		sections.push({
			key: "settings",
			content: (
				<SettingsSection
					icon={Database}
					title={t("protectionUx.settingsTitle")}
					description={t("protectionUx.settingsHelp")}
					layout="stack"
					data-testid="complete-backups-section"
				>
					<div className="space-y-5">
						<BackupStatusHeader onSetUpBackups={() => setWizardMode("new")} />
						<div className="h-px bg-border" />
						<BackupSettingRow
							title={t("protectionUx.saveLocation")}
							description={
								<>
									<span
										className="block break-all text-ui text-foreground"
										data-testid="backup-location-path"
									>
										{status.data?.localRepositoryPath ??
											status.data?.backupRoot}
									</span>
									<span className="mt-1 block">
										{t(
											desktop
												? "protectionUx.locationHelp"
												: "protectionUx.serverLocationHelp",
										)}
									</span>
									{storageBusy && desktop && (
										<span className="mt-1 block">
											{t("protectionUx.locationBusy")}
										</span>
									)}
									{folderError === "backup" && (
										<span className="mt-1 block" role="alert">
											{t("backupFolders.folderError")}
										</span>
									)}
								</>
							}
						>
							{desktop && (
								<Button
									variant="secondary"
									disabled={storageBusy || picking}
									onClick={() => void chooseFolder("backup")}
									data-testid="change-backup-location"
								>
									{t("backupFolders.changeLocation")}
								</Button>
							)}
						</BackupSettingRow>
						{localConfigured && (
							<>
								<BackupSettingRow
									title={t("protection.automatic")}
									description={t("protectionUx.automaticHelp")}
								>
									<Switch
										checked={status.data?.enabled ?? false}
										disabled={enabled.isPending || maintenance || offline}
										onCheckedChange={(checked) =>
											enabled.mutate({ enabled: checked })
										}
										aria-label={t("protection.automatic")}
									/>
								</BackupSettingRow>
								<BackupSettingRow
									title={t("protectionUx.frequency")}
									description={t("protectionUx.frequencyHelp")}
								>
									<DropdownSelect
										value={String(status.data?.autoBackupIntervalHours ?? 24)}
										disabled={
											interval.isPending ||
											maintenance ||
											offline ||
											!status.data?.enabled
										}
										onValueChange={(value) =>
											interval.mutate({ hours: Number(value) })
										}
										options={FREQUENCIES.map((frequency) => ({
											value: String(frequency.hours),
											label: t(frequency.label),
										}))}
										aria-label={t("protectionUx.frequency")}
										data-testid="backup-frequency"
									/>
								</BackupSettingRow>
								<BackupSettingRow
									title={t("protectionUx.recoveryKey")}
									description={
										<>
											{t(
												desktop
													? "backupFolders.keyHelp"
													: "protection.keyHelp",
											)}
											{keySaved && (
												<span className="mt-1 block text-muted-foreground">
													{t("protection.recoveryKeySaved")}
												</span>
											)}
										</>
									}
									data-testid={
										!desktop && !keySaved ? "recovery-key-notice" : undefined
									}
								>
									<Button
										variant="secondary"
										disabled={key.isPending || maintenance || offline}
										onClick={() => key.mutate({ repositoryId: "local" })}
									>
										{t("protection.key")}
									</Button>
								</BackupSettingRow>
							</>
						)}
					</div>
				</SettingsSection>
			),
		})
	sections.push({
		key: "available",
		content: (
			<SettingsSection
				icon={Server}
				title={t("protectionUx.availableBackups")}
				description={t("protectionUx.availableHelp")}
				layout="stack"
				data-testid="available-backups-section"
			>
				<div className="space-y-4">
					{desktop ? (
						<BackupSettingRow
							title={t("backupFolders.restoreFromFolder")}
							description={
								<>
									{t("backupFolders.restoreHelp")}
									{folderError === "restore" && (
										<span className="mt-1 block" role="alert">
											{t("backupFolders.folderError")}
										</span>
									)}
								</>
							}
						>
							<Button
								variant="secondary"
								disabled={picking}
								onClick={() => void chooseFolder("restore")}
								data-testid="restore-from-folder"
							>
								{t("backupFolders.chooseFolder")}
							</Button>
						</BackupSettingRow>
					) : !localConfigured && !restoreOnly ? (
						<BackupSettingRow
							title={t("backupSetup.startExisting")}
							description={t("backupSetup.startExistingHint")}
						>
							<Button
								variant="secondary"
								disabled={maintenance}
								onClick={() => setWizardMode("existing")}
								data-testid="setup-existing-backup"
							>
								{t("protectionUx.open")}
							</Button>
						</BackupSettingRow>
					) : null}
					{repositories.length > 1 && (
						<BackupSettingRow title={t("protection.repository")}>
							<DropdownSelect
								value={repositoryId}
								onValueChange={selectRepository}
								options={repositories.map((repo) => ({
									value: repo.id,
									label:
										repo.id === "local"
											? t("protectionUx.localBackups")
											: repo.name,
								}))}
								aria-label={t("protection.repository")}
							/>
						</BackupSettingRow>
					)}
					{sourceOnly && repository?.path && (
						<p className="break-all text-ui">
							{t("protectionUx.restoreSource", { source: repository.path })}
						</p>
					)}
					{repository && points.isError ? (
						<div
							className="flex flex-wrap items-center justify-between gap-3"
							role="alert"
						>
							<p className="text-ui">{t("protectionUx.pointsError")}</p>
							<Button
								variant="secondary"
								disabled={points.isFetching}
								onClick={() => void points.refetch()}
							>
								{t("protection.retry")}
							</Button>
						</div>
					) : repository && points.isPending ? (
						<div
							className="space-y-3"
							data-testid="available-backups-skeleton"
							aria-hidden
						>
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					) : sortedPoints.length === 0 ? (
						<p
							className="py-4 text-ui text-secondary-foreground"
							data-testid="available-backups-empty"
						>
							{t(
								restoreOnly || sourceOnly
									? "protectionUx.sourceEmpty"
									: "protectionUx.emptyHelp",
							)}
						</p>
					) : (
						<>
							{pointsPageCount > 1 && (
								<PaginationBar
									page={currentPointsPage}
									pageCount={pointsPageCount}
									onChangePage={setPointsPage}
									totalLabel={t("protectionUx.pointsCount", {
										count: sortedPoints.length,
									})}
								/>
							)}
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{visiblePoints.map((point) => (
									<RecoveryPointCard
										key={point.id}
										point={point}
										repositoryId={repositoryId}
										source={sourceName}
										canDelete={sortedPoints.length > 1}
										restoreOnly={restoreOnly || maintenance || sourceOnly}
									/>
								))}
							</div>
							{pointsPageCount > 1 && (
								<PaginationBar
									page={currentPointsPage}
									pageCount={pointsPageCount}
									onChangePage={setPointsPage}
									totalLabel={t("protectionUx.pointsCount", {
										count: sortedPoints.length,
									})}
								/>
							)}
						</>
					)}
				</div>
			</SettingsSection>
		),
	})
	const canManage = Boolean(repository) && !maintenance && !sourceOnly
	if (!restoreOnly && (canManage || hasJobs))
		sections.push({
			key: "management",
			content: (
				<SettingsSection
					icon={History}
					title={t("protectionUx.managementTitle")}
					description={t("protectionUx.managementHelp")}
					layout="stack"
					data-testid="backup-management-section"
				>
					<div className="space-y-4">
						{canManage && (
							<BackupManagement
								key={repositoryId}
								repositoryId={repositoryId}
							/>
						)}
						{hasJobs && (
							<BackupSettingRow
								title={t("protection.jobs")}
								description={t("protectionUx.jobsHelp")}
								data-testid="recent-operations-section"
							>
								<Button
									variant="secondary"
									onClick={() => setOperationsOpen(true)}
									data-testid="recent-operations-open"
								>
									<Icon icon={History} />
									{t("common.view")}
								</Button>
							</BackupSettingRow>
						)}
					</div>
				</SettingsSection>
			),
		})
	return (
		<div data-testid="complete-backups">
			{status.isPending ? (
				<BackupsSkeleton />
			) : status.isError ? (
				<div
					className="flex flex-wrap items-center justify-between gap-3"
					role="alert"
				>
					<p className="text-ui">{status.error.message}</p>
					<Button
						variant="secondary"
						disabled={status.isFetching}
						onClick={() => void status.refetch()}
					>
						{t("protection.retry")}
					</Button>
				</div>
			) : (
				sections.map((section, index) => (
					<Fragment key={section.key}>
						{index > 0 && <SectionDivider />}
						{section.content}
					</Fragment>
				))
			)}
			<BackupSetupWizard
				key={wizardMode}
				open={wizardMode !== null}
				onOpenChange={(open) => {
					if (!open) setWizardMode(null)
				}}
				onStarted={() => setWizardMode(null)}
				mode={wizardMode ?? "new"}
			/>
			{desktop && folderSelection && (
				<BackupFolderDialog
					key={folderSelection.id}
					selection={folderSelection}
					open
					onOpenChange={(open) => {
						if (!open) setFolderSelection(undefined)
					}}
					onSourceOpened={selectRepository}
				/>
			)}
			<RecentOperationsDialog
				open={operationsOpen}
				onOpenChange={setOperationsOpen}
			/>
		</div>
	)
}

function BackupSettingRow(props: {
	readonly title: ReactNode
	readonly description?: ReactNode
	readonly children?: ReactNode
	readonly "data-testid"?: string
}) {
	return (
		<div
			className="flex flex-wrap items-center justify-between gap-4"
			data-testid={props["data-testid"]}
		>
			<div className="min-w-0 flex-1 basis-48">
				<div className="text-ui font-semibold text-foreground">
					{props.title}
				</div>
				{props.description && (
					<div className="mt-0.5 text-xs leading-5 text-muted-foreground">
						{props.description}
					</div>
				)}
			</div>
			{props.children && <div className="shrink-0">{props.children}</div>}
		</div>
	)
}
