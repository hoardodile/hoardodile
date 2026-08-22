import { Badge } from "@hoardodile/ui/components/badge"
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@hoardodile/ui/components/breadcrumb"
import { Button } from "@hoardodile/ui/components/button"
import {
	Empty,
	EmptyDescription,
	EmptyMedia,
	EmptyTitle,
} from "@hoardodile/ui/components/empty"
import { Progress } from "@hoardodile/ui/components/progress"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@hoardodile/ui/components/table"
import { Check, Cross } from "@hoardodile/ui/icons/marks"
import {
	AltArrowRight,
	Archive,
	Box,
	Download,
	File,
	Folder,
	FolderOpen,
	MagnifierZoomIn,
	UndoRightRound,
} from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { Fragment, useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { importKeys } from "@/features/res/api"
import { formatBytes } from "@/lib/formatBytes"
import { trpcMutate, trpcQuery } from "@/trpc/factory"
import { UploadSection } from "./UploadSection"
import { stageArchive, type UploadProgress } from "./upload"

type ImportPhase = "source" | "browsing" | "preview" | "importing" | "done"

type ScannedEntry = {
	readonly name: string
	readonly path: string
	readonly kind: "file" | "dir"
	readonly contentPluginId: string
	readonly pluginName: string
}

type ImportResult = {
	readonly scanned: number
	readonly imported: number
	readonly failed: number
	readonly warnings: readonly string[]
}

const PHASES: ImportPhase[] = [
	"source",
	"browsing",
	"preview",
	"importing",
	"done",
]

/**
 * Unified folder-import component replacing the former `ArchiveUploader`
 * and `ServerPathImporter`. Supports two source types:
 *
 * 1. **Shared folder** — browse the shared folder from a configured root
 *    directory via backend-returned directory listings.
 * 2. **Zip file** — upload a zip, extract server-side, then browse the
 *    extracted contents the same way.
 *
 * Both flows converge on the same scan → preview → import pipeline.
 */
export function FolderImporter(): ReactNode {
	const { t } = useTranslation()
	const [browseRoot, setBrowseRoot] = useState<string | undefined>(undefined)
	const [currentSubPath, setCurrentSubPath] = useState("")
	const [phase, setPhase] = useState<ImportPhase>("source")
	const [scanEntries, setScanEntries] = useState<readonly ScannedEntry[]>([])
	const [importResult, setImportResult] = useState<ImportResult | undefined>(
		undefined,
	)
	/** Whether the browse root is a zip extraction (needs cleanup on import). */
	const [isExtracted, setIsExtracted] = useState(false)

	// Fetch server import root once.
	const configQuery = useQuery({
		queryKey: importKeys.config(),
		queryFn: () => trpcQuery("resource", "importConfig"),
		staleTime: Infinity,
	})

	// Browse directory at current level.
	const browseQuery = useQuery({
		queryKey: importKeys.browseDirectory(browseRoot ?? "", currentSubPath),
		queryFn: () =>
			trpcQuery("resource", "browseDirectory", {
				root: browseRoot!,
				subPath: currentSubPath || undefined,
			}),
		enabled: browseRoot !== undefined && phase === "browsing",
		staleTime: Infinity,
	})

	// Extract archive mutation.
	const extractMut = useMutation({
		mutationFn: (archiveFileId: string) =>
			trpcMutate("resource", "extractArchive", { archiveFileId }),
		onSuccess: (data) => {
			setBrowseRoot(data.extractDir)
			setIsExtracted(true)
			setPhase("browsing")
		},
	})

	// Folder import mutation.
	const importMut = useMutation({
		mutationFn: (opts: { root: string; subPath?: string }) =>
			trpcMutate("resource", "folderImport", {
				root: opts.root,
				subPath: opts.subPath || undefined,
				cleanupExtract: isExtracted,
			}),
		onSuccess: (report) => {
			setImportResult(report)
			setPhase("done")
		},
	})

	const handleSelectShared = useCallback(() => {
		const root = configQuery.data?.sharedFolderRoot
		if (root !== undefined) {
			setBrowseRoot(root)
			setCurrentSubPath("")
			setIsExtracted(false)
			setPhase("browsing")
		}
	}, [configQuery.data])

	const handleScanHere = useCallback(() => {
		if (browseRoot === undefined) return
		setPhase("preview")
		trpcQuery("resource", "folderScan", {
			root: browseRoot,
			subPath: currentSubPath || undefined,
		})
			.then((entries) => {
				setScanEntries(entries)
			})
			.catch(() => {
				setPhase("browsing")
			})
	}, [browseRoot, currentSubPath])

	const handleImport = useCallback(() => {
		if (browseRoot === undefined) return
		setPhase("importing")
		importMut.mutate({
			root: browseRoot,
			subPath: currentSubPath || undefined,
		})
	}, [browseRoot, currentSubPath, importMut])

	const navigateTo = useCallback((subPath: string) => {
		setCurrentSubPath(subPath)
	}, [])

	const handleReset = useCallback(() => {
		setBrowseRoot(undefined)
		setCurrentSubPath("")
		setPhase("source")
		setScanEntries([])
		setImportResult(undefined)
		setIsExtracted(false)
	}, [])

	const phaseIndex = PHASES.indexOf(phase)
	// Once import starts the pipeline is committed — earlier steps can no
	// longer be jumped back to until the flow resets.
	const stepperLocked = phase === "importing" || phase === "done"

	function stepperLabel(step: ImportPhase): string {
		switch (step) {
			case "source":
				return t("resources.new.folder.stepSource")
			case "browsing":
				return t("resources.new.folder.stepBrowse")
			case "preview":
				return t("resources.new.folder.stepPreview")
			case "importing":
				return t("resources.new.folder.stepImport")
			case "done":
				return t("resources.new.folder.stepDone")
		}
	}

	return (
		<div className="flex flex-col gap-5">
			{/* Stepper */}
			<nav aria-label={t("resources.new.folder.stepsAria")}>
				<ol className="flex items-center gap-1">
					{PHASES.map((step, index) => {
						const isCurrent = phase === step
						const isPast = index < phaseIndex
						return (
							<li key={step} className="flex min-w-0 flex-1 items-center">
								<button
									type="button"
									disabled={stepperLocked || !isPast || step === "done"}
									onClick={() => {
										if (isPast) {
											// Jump back to a previous step, clearing later state
											if (step === "source") handleReset()
											else if (step === "browsing") {
												setScanEntries([])
												setPhase("browsing")
											}
										}
									}}
									className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium transition-colors ${
										isCurrent
											? "bg-primary/10 text-primary"
											: isPast
												? stepperLocked
													? "text-muted-foreground"
													: "text-muted-foreground hover:bg-muted hover:text-foreground"
												: "text-muted-foreground/60"
									}`}
								>
									<span
										className={`flex size-5 shrink-0 items-center justify-center rounded-full text-tiny ${
											isCurrent
												? "bg-primary text-primary-foreground"
												: isPast
													? "bg-muted text-foreground"
													: "bg-muted/50 text-muted-foreground"
										}`}
									>
										{isPast ? <Check className="size-3" /> : index + 1}
									</span>
									<span className="hidden truncate sm:inline">
										{stepperLabel(step)}
									</span>
								</button>
								{index < PHASES.length - 1 && (
									<AltArrowRight className="mx-1 size-4 shrink-0 text-muted-foreground/40" />
								)}
							</li>
						)
					})}
				</ol>
			</nav>

			{/* Source step */}
			{phase === "source" && (
				<SourceStep
					onSelectShared={handleSelectShared}
					configPending={configQuery.isPending}
					sharedFolderRoot={configQuery.data?.sharedFolderRoot}
					onExtracted={(extractDir) => {
						setBrowseRoot(extractDir)
						setIsExtracted(true)
						setPhase("browsing")
					}}
					extractMut={extractMut}
				/>
			)}

			{/* Browse step */}
			{phase === "browsing" && browseRoot !== undefined && (
				<BrowseStep
					browseRoot={browseRoot}
					currentSubPath={currentSubPath}
					isExtracted={isExtracted}
					entries={browseQuery.data?.entries ?? []}
					isLoading={browseQuery.isLoading}
					onNavigate={navigateTo}
					onScanHere={handleScanHere}
					onReset={handleReset}
				/>
			)}

			{/* Preview step */}
			{phase === "preview" && (
				<PreviewStep
					entries={scanEntries}
					onBack={() => setPhase("browsing")}
					onImport={handleImport}
					isImporting={importMut.isPending}
				/>
			)}

			{/* Importing step */}
			{phase === "importing" && (
				<ImportingStep onCancel={() => setPhase("preview")} />
			)}

			{/* Done step */}
			{phase === "done" && importResult !== undefined && (
				<ResultStep result={importResult} onReset={handleReset} />
			)}

			{/* How it works — stays visible through every phase. */}
			<HowItWorksSection />
		</div>
	)
}

/* ------------------------------------------------------------------ */
// Stepper sub-components
/* ------------------------------------------------------------------ */

type SourceStepProps = {
	readonly onSelectShared: () => void
	readonly configPending: boolean
	readonly sharedFolderRoot: string | undefined
	readonly onExtracted: (extractDir: string) => void
	readonly extractMut: ReturnType<
		typeof useMutation<{ extractDir: string }, Error, string>
	>
}

/**
 * Source selection — two big centered chooser cards: pick an archive, or
 * browse a shared folder.
 */
function SourceStep(props: SourceStepProps): ReactNode {
	const {
		onSelectShared,
		configPending,
		sharedFolderRoot,
		onExtracted,
		extractMut,
	} = props
	const { t } = useTranslation()

	return (
		<div className="grid gap-6 sm:grid-cols-2">
			<ZipUploader onExtracted={onExtracted} extractMut={extractMut} />
			<button
				type="button"
				data-testid="folder-source-shared"
				disabled={configPending || sharedFolderRoot === undefined}
				onClick={onSelectShared}
				className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
					<FolderOpen className="size-4" />
				</span>
				<span className="flex flex-col gap-1">
					<span className="text-sm font-semibold text-foreground">
						{t("resources.new.folder.sourceShared")}
					</span>
					<span className="text-xs text-muted-foreground">
						{sharedFolderRoot === undefined
							? t("resources.new.folder.sourceSharedDisabled")
							: t("resources.new.folder.sourceSharedDescription")}
					</span>
					{sharedFolderRoot !== undefined && (
						<span className="mt-1 break-all font-mono text-tiny text-muted-foreground/80">
							{sharedFolderRoot}
						</span>
					)}
				</span>
			</button>
		</div>
	)
}

/** "How it works" — the pipeline the stepper walks through. Always
    visible below the active step. */
function HowItWorksSection(): ReactNode {
	const { t } = useTranslation()
	const howSteps = [
		{
			icon: FolderOpen,
			title: t("resources.new.folder.howScan"),
			meta: t("resources.new.folder.howScanMeta"),
		},
		{
			icon: MagnifierZoomIn,
			title: t("resources.new.folder.howPreview"),
			meta: t("resources.new.folder.howPreviewMeta"),
		},
		{
			icon: Download,
			title: t("resources.new.folder.howImport"),
			meta: t("resources.new.folder.howImportMeta"),
		},
	]
	return (
		<div>
			<SectionLabel>{t("resources.new.folder.howTitle")}</SectionLabel>
			<div className="mt-2">
				{howSteps.map((step) => {
					const StepIcon = step.icon
					return (
						<div
							key={step.title}
							className="flex h-12 min-w-0 items-center gap-3 border-b border-border last:border-b-0"
						>
							<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
								<StepIcon className="size-4" />
							</span>
							<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
								{step.title}
							</span>
							<span className="text-right text-xs text-muted-foreground">
								{step.meta}
							</span>
						</div>
					)
				})}
			</div>
		</div>
	)
}

type BrowseStepProps = {
	readonly browseRoot: string
	readonly currentSubPath: string
	readonly isExtracted: boolean
	readonly entries: readonly { name: string; kind: "dir" | "file" }[]
	readonly isLoading: boolean
	readonly onNavigate: (subPath: string) => void
	readonly onScanHere: () => void
	readonly onReset: () => void
}

function BrowseStep(props: BrowseStepProps): ReactNode {
	const {
		currentSubPath,
		isExtracted,
		entries,
		isLoading,
		onNavigate,
		onScanHere,
		onReset,
	} = props
	const { t } = useTranslation()

	const segments = currentSubPath
		? currentSubPath.split("/").filter(Boolean)
		: []

	const rootLabel = isExtracted
		? t("resources.new.folder.zipRoot")
		: t("resources.new.folder.sharedRoot")

	return (
		<div className="flex flex-col">
			<UploadSection
				icon={FolderOpen}
				title={t("resources.new.folder.browseTitle")}
				description={t("resources.new.folder.browseDescription")}
				data-testid="folder-browse-section"
			>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink
								render={
									<button
										type="button"
										onClick={() => onNavigate("")}
										className="cursor-pointer"
									/>
								}
							>
								{rootLabel}
							</BreadcrumbLink>
						</BreadcrumbItem>
						{segments.map((seg, i) => {
							const pathToHere = segments.slice(0, i + 1).join("/")
							const isLast = i === segments.length - 1
							return (
								<Fragment key={pathToHere}>
									<BreadcrumbSeparator />
									<BreadcrumbItem>
										{isLast ? (
											<BreadcrumbPage>{seg}</BreadcrumbPage>
										) : (
											<BreadcrumbLink
												render={
													<button
														type="button"
														onClick={() => onNavigate(pathToHere)}
														className="cursor-pointer"
													/>
												}
											>
												{seg}
											</BreadcrumbLink>
										)}
									</BreadcrumbItem>
								</Fragment>
							)
						})}
					</BreadcrumbList>
				</Breadcrumb>

				{isLoading ? (
					<p className="text-sm text-muted-foreground">
						{t("resources.new.folder.scanning")}
					</p>
				) : (
					<DirectoryListing entries={entries} onNavigate={onNavigate} />
				)}
			</UploadSection>

			<div className="mt-4 flex flex-wrap justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onReset}>
					{t("common.back")}
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={onScanHere}
					data-testid="folder-scan-here"
				>
					{t("resources.new.folder.scanHere")}
				</Button>
			</div>
		</div>
	)
}

function DirectoryListing(props: {
	readonly entries: readonly { name: string; kind: "dir" | "file" }[]
	readonly onNavigate: (name: string) => void
}): ReactNode {
	const { entries, onNavigate } = props
	const { t } = useTranslation()

	if (entries.length === 0) {
		return (
			<Empty className="py-10">
				<EmptyMedia variant="icon">
					<FolderOpen className="size-5" />
				</EmptyMedia>
				<EmptyTitle>{t("resources.new.folder.emptyTitle")}</EmptyTitle>
				<EmptyDescription>
					{t("resources.new.folder.emptyDescription")}
				</EmptyDescription>
			</Empty>
		)
	}

	return (
		<ul className="flex flex-col" data-testid="folder-directory-list">
			{entries.map((entry) => (
				<li key={entry.name}>
					{entry.kind === "dir" ? (
						<button
							type="button"
							onClick={() => onNavigate(entry.name)}
							data-testid="folder-dir-item"
							className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
						>
							<Folder className="size-4 shrink-0 text-primary" />
							<span className="truncate">{entry.name}</span>
						</button>
					) : (
						<span className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground">
							<File className="size-4 shrink-0" />
							<span className="truncate">{entry.name}</span>
						</span>
					)}
				</li>
			))}
		</ul>
	)
}

function PreviewStep(props: {
	readonly entries: readonly ScannedEntry[]
	readonly onBack: () => void
	readonly onImport: () => void
	readonly isImporting: boolean
}): ReactNode {
	const { entries, onBack, onImport, isImporting } = props
	const { t } = useTranslation()

	return (
		<div className="flex flex-col">
			<UploadSection
				icon={Archive}
				title={t("resources.new.folder.previewTitle")}
				description={t("resources.new.folder.previewDescription")}
				data-testid="folder-preview-section"
			>
				<p className="text-sm text-muted-foreground">
					{t("resources.new.folder.previewCount", { count: entries.length })}
				</p>

				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="pl-3">
								{t("resources.new.folder.name")}
							</TableHead>
							<TableHead>{t("resources.new.folder.type")}</TableHead>
							<TableHead>{t("resources.new.folder.plugin")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{entries.map((item) => (
							<TableRow key={item.path}>
								<TableCell className="pl-3">
									<div className="flex items-center gap-2">
										{item.kind === "dir" ? (
											<Folder className="size-4 text-primary" />
										) : (
											<File className="size-4 text-muted-foreground" />
										)}
										<span className="truncate">{item.name}</span>
									</div>
								</TableCell>
								<TableCell className="capitalize">{item.kind}</TableCell>
								<TableCell>{item.pluginName}</TableCell>
							</TableRow>
						))}
						{entries.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={3}
									className="py-6 text-center text-sm text-muted-foreground"
								>
									{t("resources.new.folder.noSubdirs")}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</UploadSection>

			<div className="mt-4 flex flex-wrap justify-end gap-2">
				<Button type="button" variant="outline" size="sm" onClick={onBack}>
					{t("common.back")}
				</Button>
				<Button
					type="button"
					size="sm"
					onClick={onImport}
					disabled={isImporting || entries.length === 0}
					data-testid="folder-confirm-import"
				>
					{isImporting
						? t("resources.new.folder.importing")
						: t("resources.new.folder.confirmImport")}
				</Button>
			</div>
		</div>
	)
}

function ImportingStep(props: { readonly onCancel: () => void }): ReactNode {
	const { onCancel } = props
	const { t } = useTranslation()

	return (
		<div className="flex flex-col items-center gap-4 py-8 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
				<FolderOpen className="size-6 text-primary" />
			</div>
			<div className="flex flex-col gap-1">
				<h3 className="text-sm font-semibold">
					{t("resources.new.folder.importing")}
				</h3>
				<p className="text-xs text-muted-foreground">
					{t("resources.new.folder.importingDescription")}
				</p>
			</div>
			<Progress value={null} className="w-full max-w-xs" />
			<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
				{t("common.cancel")}
			</Button>
		</div>
	)
}

function ResultStep(props: {
	readonly result: ImportResult
	readonly onReset: () => void
}): ReactNode {
	const { result, onReset } = props
	const { t } = useTranslation()

	const hasFailures = result.failed > 0 || result.warnings.length > 0

	return (
		<div className="flex flex-col">
			<UploadSection
				icon={hasFailures ? Cross : Check}
				title={t("resources.new.folder.resultTitle")}
				data-testid="folder-result-section"
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap gap-2">
						<Badge variant="secondary" className="rounded-md font-normal">
							{t("resources.new.folder.resultScanned")}: {result.scanned}
						</Badge>
						<Badge variant="default" className="rounded-md font-normal">
							{t("resources.new.folder.resultImported")}: {result.imported}
						</Badge>
						{result.failed > 0 && (
							<Badge variant="destructive" className="rounded-md font-normal">
								{t("resources.new.folder.resultFailed")}: {result.failed}
							</Badge>
						)}
					</div>
					{result.warnings.length > 0 && (
						<ul className="list-disc pl-5 text-sm text-destructive">
							{result.warnings.map((w) => (
								<li key={w}>{w}</li>
							))}
						</ul>
					)}
				</div>
			</UploadSection>

			<div className="mt-4 flex justify-end">
				<Button
					type="button"
					size="sm"
					onClick={onReset}
					data-testid="folder-import-done"
				>
					<UndoRightRound className="mr-1 size-4" />
					{t("resources.new.folder.importDone")}
				</Button>
			</div>
		</div>
	)
}

/**
 * Zip file picker that uploads and extracts the archive server-side.
 * Shows upload progress during staging, then calls `extractArchive`
 * to produce an extraction directory for browsing.
 */
function ZipUploader(props: {
	readonly onExtracted: (extractDir: string) => void
	readonly extractMut: ReturnType<
		typeof useMutation<{ extractDir: string }, Error, string>
	>
}): ReactNode {
	const { extractMut } = props
	const { t } = useTranslation()
	const inputRef = useRef<HTMLInputElement>(null)
	const [dragOver, setDragOver] = useState(false)
	const [file, setFile] = useState<File | undefined>(undefined)
	const [progress, setProgress] = useState<UploadProgress | undefined>(
		undefined,
	)
	const [uploading, setUploading] = useState(false)

	const handlePick = useCallback(
		async (picked: FileList | null) => {
			if (picked === null || picked.length === 0) return
			const selected = picked[0]
			if (selected === undefined) return
			setFile(selected)
			setUploading(true)
			setProgress({ loaded: 0, total: selected.size })
			try {
				const { fileId } = await stageArchive({
					archive: selected,
					onProgress: (p) => setProgress(p),
				})
				setProgress(undefined)
				extractMut.mutate(fileId)
			} catch {
				setUploading(false)
				setProgress(undefined)
			}
		},
		[extractMut],
	)

	function openPicker() {
		inputRef.current?.click()
	}

	function handleDragOver(event: React.DragEvent) {
		event.preventDefault()
		setDragOver(true)
	}

	function handleDragLeave(event: React.DragEvent) {
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
			return
		}
		setDragOver(false)
	}

	function handleDrop(event: React.DragEvent) {
		event.preventDefault()
		setDragOver(false)
		handlePick(event.dataTransfer.files)
	}

	const isBusy = uploading || extractMut.isPending

	return (
		<div className="flex w-full flex-col">
			<input
				ref={inputRef}
				type="file"
				accept=".zip,application/zip,application/x-zip-compressed"
				className="sr-only"
				onChange={(e) => {
					handlePick(e.target.files)
					e.target.value = ""
				}}
			/>
			{file === undefined ? (
				<button
					type="button"
					onClick={openPicker}
					disabled={isBusy}
					data-testid="folder-source-zip"
					className={`flex cursor-pointer select-none flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
						dragOver ? "border-primary bg-accent" : "hover:bg-accent"
					}`}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
						<Box className="size-4" />
					</span>
					<span className="flex flex-col gap-1">
						<span className="text-sm font-semibold text-foreground">
							{t("resources.new.folder.sourceZip")}
						</span>
						<span className="text-xs text-muted-foreground">
							{t("resources.new.folder.sourceZipDescription")}
						</span>
					</span>
				</button>
			) : (
				<div className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card px-4 py-5">
					<div className="flex items-center gap-3 rounded-lg bg-muted/35 px-3 py-2">
						<Archive className="size-5 text-muted-foreground" />
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="truncate text-sm font-medium" title={file.name}>
								{file.name}
							</span>
							<span className="text-xs text-muted-foreground">
								{formatBytes(file.size)}
							</span>
						</div>
						{isBusy && (
							<span className="text-xs text-muted-foreground">
								{extractMut.isPending
									? t("resources.new.folder.extracting")
									: t("resources.new.folder.uploading")}
							</span>
						)}
					</div>
					{progress !== undefined && progress.total > 0 && (
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className="h-full bg-primary transition-[width] duration-200 ease-out"
								style={{
									width: `${Math.round((progress.loaded / progress.total) * 100)}%`,
								}}
							/>
						</div>
					)}
				</div>
			)}
		</div>
	)
}
