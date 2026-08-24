import {
	MAX_INTRO_LENGTH,
	MAX_NAME_LENGTH,
	MAX_SOURCE_NAME_LENGTH,
	MAX_URL_LENGTH,
} from "@hoardodile/schemas"

import { pluginManifestId as pluginManifestIdSchema } from "@hoardodile/sdk-types/schema"
import { Button } from "@hoardodile/ui/components/button"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { FixedActionBar } from "@hoardodile/ui/components/fixed-action-bar"
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@hoardodile/ui/components/form"
import { ImageCropPanel } from "@hoardodile/ui/components/image-crop-panel"
import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { PageHeader } from "@hoardodile/ui/components/page-header"
import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { toast } from "@hoardodile/ui/components/toast"
import {
	FileText,
	Gallery,
	GalleryWide,
	Link as LinkIcon,
} from "@hoardodile/ui/icons/registry"
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { CharChipsPicker } from "@/features/char"
import {
	attachResourceToCollectionMutation,
	ColPicker,
	colsForResourceQueryOptions,
} from "@/features/col"
import {
	pluginListAllQueryOptions,
	resolveManifestName,
} from "@/features/plugin"
import {
	createResourceWithUploadMutation,
	duplicateImagesQueryOptions,
	FileListEditor,
	type FileListEntry,
	invalidateResources,
	resDetailQueryOptions,
	SOURCE_NAME_DATALIST_ID,
	SourceNameSuggest,
} from "@/features/res"
import { onImageHashesReady } from "@/features/res/api/dup-toast"
import { UploadSection } from "@/features/res/upload/UploadSection"
import { useBatchResourceSubmit } from "@/features/res/upload/useBatchResourceSubmit"
import { useIncrementalStaging } from "@/features/res/upload/useIncrementalStaging"
import { uploadResCoverCropped } from "@/features/res/utils/coverCapture"
import { formatDateTime, useDatePrefs } from "@/features/settings/datePrefs"
import { errorMessage } from "@/lib/errors"
import { formatBytes } from "@/lib/formatBytes"

const schema = z.object({
	name: z.string().max(MAX_NAME_LENGTH),
	intro: z.string().max(MAX_INTRO_LENGTH),
	sourceName: z.string().max(MAX_SOURCE_NAME_LENGTH),
	sourceUrl: z.string().max(MAX_URL_LENGTH),
	contentPluginId: pluginManifestIdSchema.nullable(),
})

type FormValues = z.infer<typeof schema>

const searchSchema = z.object({
	charId: z.string().min(1).optional(),
	/**
	 * Pre-fill the form from an existing resource. Used by the "create
	 * similar resource" action so users can spin up a sibling without
	 * re-entering the same metadata. Only public fields are inherited;
	 * uploads still require the user to pick new files.
	 */
	cloneFrom: z.string().min(1).optional(),
})

export const Route = createFileRoute("/resources/new")({
	component: NewResourceRoute,
	validateSearch: searchSchema,
})

type NewResourceNameResolution = Readonly<{
	trimmedNameInput: string
	useFilenameAsName: boolean
	orderedFiles: readonly File[]
}>

function resolvedNameForNewResourceSubmission(
	resolution: NewResourceNameResolution,
): string | undefined {
	const typed = resolution.trimmedNameInput
	if (typed.length > 0) return typed
	if (!resolution.useFilenameAsName) return undefined
	const fname = resolution.orderedFiles[0]?.name
	if (fname === undefined) return undefined
	const base = basenameWithoutExt(fname).trim()
	return base.length > 0 ? base : undefined
}

function basenameWithoutExt(filename: string): string {
	const dot = filename.lastIndexOf(".")
	if (dot <= 0) return filename
	return filename.slice(0, dot)
}

function buildIdentityOrder(length: number): readonly number[] {
	return Array.from({ length }, (_, i) => i)
}

/**
 * Number of entries whose (case-insensitive) filename appears more than
 * once in the batch. The server auto-suffixes such collisions
 * (`1.jpg` → `1-1.jpg`) at commit; surfacing them up front keeps the
 * rename from being a surprise.
 */
function duplicateFileNameCount(entries: readonly FileListEntry[]): number {
	const counts = new Map<string, number>()
	for (const entry of entries) {
		const key = entry.file.name.toLowerCase()
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}
	let duplicates = 0
	for (const count of counts.values()) {
		if (count > 1) duplicates += count
	}
	return duplicates
}

function NewResourceRoute() {
	const { t, i18n } = useTranslation()
	const { dateFormat, timeZone } = useDatePrefs()
	const qc = useQueryClient()
	const { charId: prefilledCharacterId, cloneFrom } = Route.useSearch()
	const [entries, setEntries] = useState<readonly FileListEntry[]>([])
	const [displayOrder, setDisplayOrder] = useState<readonly number[]>([])
	const [tagIds, setTagIds] = useState<readonly string[]>([])
	const [charIds, setCharacterIds] = useState<readonly string[]>(
		prefilledCharacterId !== undefined ? [prefilledCharacterId] : [],
	)
	// Collection IDs the user has chosen for the new resource. Pre-filled
	// from the clone source on first load (see effect below) but always
	// editable via the picker. After creation each id receives an
	// `attachResourceToCollection` call.
	const [selectedCollectionIds, setSelectedCollectionIds] = useState<
		readonly string[]
	>([])
	// Optional cover image. Cropped in the same ImageCropPanel used by the
	// character creation form; the cropped blob is uploaded after the
	// resource row is created.
	const [coverCrop, setCoverCrop] = useState<CroppedImage | undefined>(
		undefined,
	)
	// Bumped after every successful submit (and on "clear all") to remount
	// the cover crop panel, resetting its internal image preview — the
	// panel is uncontrolled and would otherwise keep showing the last crop.
	const [formResetNonce, setFormResetNonce] = useState(0)
	const pluginListQuery = useQuery(pluginListAllQueryOptions())
	const pluginOptions = [
		{ value: "", label: t("resources.new.autoDetect") },
		...(pluginListQuery.data ?? []).map((p) => ({
			value: p.id,
			label: resolveManifestName(p.manifest, i18n.language),
		})),
	]

	const [useFilenameAsName, setUseFilenameAsName] = useState(true)
	const [splitOrderedIntoResources, setSplitOrderedIntoResources] =
		useState(false)

	// Auto-staging state (non-batch mode)
	const { fileIds, fileProgresses, isStaging } = useIncrementalStaging(entries)

	const form = useForm<FormValues>({
		resolver: standardSchemaResolver(schema),
		defaultValues: {
			name: "",
			intro: "",
			sourceName: "",
			sourceUrl: "",
			contentPluginId: null,
		},
	})

	// Source-resource lookup for "create similar". Disabled when no
	// cloneFrom param so the standard /resources/new path stays a single
	// network request.
	const cloneDetailQuery = useQuery({
		...resDetailQueryOptions(cloneFrom ?? ""),
		enabled: cloneFrom !== undefined,
	})
	const cloneCollectionsQuery = useQuery({
		...colsForResourceQueryOptions(cloneFrom ?? ""),
		enabled: cloneFrom !== undefined,
	})

	useEffect(() => {
		if (cloneFrom === undefined) return
		const source = cloneDetailQuery.data
		if (source === undefined) return
		// Only seed the form once per source load; subsequent renders must
		// not clobber the user's edits.
		form.reset({
			name: source.name,
			intro: source.intro,
			sourceName: source.sourceName ?? "",
			sourceUrl: source.sourceUrl ?? "",
			contentPluginId: source.contentPluginId,
		})
		setTagIds(source.tagIds)
		setCharacterIds((existing) =>
			existing.length > 0 ? existing : source.charIds,
		)
	}, [cloneFrom, cloneDetailQuery.data, form])

	useEffect(() => {
		const cols = cloneCollectionsQuery.data
		if (cols === undefined) return
		// Only seed if the user hasn't picked anything yet, so an in-flight
		// query result doesn't clobber an explicit selection.
		setSelectedCollectionIds((existing) =>
			existing.length > 0 ? existing : cols.map((c) => c.id),
		)
	}, [cloneCollectionsQuery.data])

	const attachCollectionMut = useMutation(attachResourceToCollectionMutation())
	const createMut = useMutation(createResourceWithUploadMutation())

	// One-shot hash-ready subscriptions for resources created on this page;
	// disposed on unmount so a never-firing listener cannot leak.
	const dupWatchCleanupsRef = useRef<readonly (() => void)[]>([])
	useEffect(() => {
		const cleanups = dupWatchCleanupsRef.current
		return () => {
			for (const cleanup of cleanups) cleanup()
		}
	}, [])

	/**
	 * Register a one-shot wait for the new resource's hash rebuild (SSE
	 * `imageHashes` event), then surface duplicate resources as a toast.
	 * Hashes are computed asynchronously after commit, so this is the
	 * earliest moment a duplicate warning can appear.
	 */
	function watchForDuplicates(resId: string): void {
		const unsubscribe = onImageHashesReady(resId, () => {
			void qc
				.fetchQuery(duplicateImagesQueryOptions(resId))
				.then((entries) => {
					if (entries.length === 0) return
					const names = entries
						.slice(0, 3)
						.map((entry) => entry.resource.name)
						.join(", ")
					toast.add({
						title: t("resources.new.duplicatesFound", {
							count: entries.length,
							names,
						}),
						type: "warning",
					})
				})
				.catch(() => {})
		})
		dupWatchCleanupsRef.current = [...dupWatchCleanupsRef.current, unsubscribe]
	}

	async function finalizeNewResource(createdId: string): Promise<void> {
		const tasks: Promise<unknown>[] = []
		for (const colId of selectedCollectionIds) {
			tasks.push(
				attachCollectionMut.mutateAsync({
					colId,
					resId: createdId,
				}),
			)
		}
		if (coverCrop !== undefined) {
			tasks.push(uploadResCoverCropped(createdId, coverCrop, qc))
		}
		await Promise.all(tasks).catch(() => {
			// Per-attach / cover errors are non-fatal: the resource exists
			// and the user can still attach manually from the actions menu.
			toast.add({
				title: t("resources.new.errors.attachCollectionsFailed"),
				type: "error",
			})
		})
	}

	function defaultResourceName(): string {
		return formatDateTime(Date.now(), dateFormat, timeZone)
	}

	function resolveSubmittedResourceName(
		trimmedNameInput: string,
		activeFiles: readonly File[],
	): string {
		return (
			resolvedNameForNewResourceSubmission({
				trimmedNameInput,
				useFilenameAsName,
				orderedFiles: activeFiles,
			}) ?? defaultResourceName()
		)
	}

	function buildCreatePayload(
		files: readonly string[],
		values: FormValues,
		resolvedName: string,
		names?: readonly string[],
	) {
		return {
			files,
			names,
			name: resolvedName,
			intro: values.intro.length > 0 ? values.intro : undefined,
			sourceName: values.sourceName.trim() || undefined,
			sourceUrl: values.sourceUrl.trim() || undefined,
			contentPluginId: values.contentPluginId ?? undefined,
			tagIds,
			charIds: charIds.length > 0 ? charIds : undefined,
		}
	}

	function orderedFilesFromEntries(
		entryList: readonly FileListEntry[],
	): readonly File[] {
		return entryList.map((e) => e.file)
	}

	// The batch path consumes entries in the user's drag order (not the
	// insertion order `entries` keeps), matching the single-resource
	// path's `displayOrder` mapping below.
	const orderedEntries = displayOrder
		.map((i) => entries[i])
		.filter((e): e is FileListEntry => e !== undefined)

	const batchSubmit = useBatchResourceSubmit({
		entries: orderedEntries,
		name: form.watch("name"),
		intro: form.watch("intro"),
		sourceName: form.watch("sourceName"),
		sourceUrl: form.watch("sourceUrl"),
		contentPluginId: form.watch("contentPluginId"),
		tagIds,
		charIds,
		selectedCollectionIds,
		coverCrop,
		useFilenameAsName,
		resolveResourceName: (name, _useFilenameAsName, file) =>
			resolveSubmittedResourceName(name, [file]),
		attachToCollection: (colId, resId) =>
			attachCollectionMut.mutateAsync({ colId, resId }),
		uploadCover:
			coverCrop !== undefined
				? (resId) => uploadResCoverCropped(resId, coverCrop, qc)
				: undefined,
		onSuccess: async () => {
			await invalidateResources(qc)
			toast.add({
				title: t("resources.new.createdCount", { count: entries.length }),
				type: "success",
			})
			setEntries([])
			setDisplayOrder([])
			setCoverCrop(undefined)
			setFormResetNonce((n) => n + 1)
		},
		onError: (message) => {
			toast.add({ title: message, type: "error" })
			toast.add({ title: t("resources.new.errors.batchPartialHint") })
		},
	})

	async function onSubmit(values: FormValues) {
		// Re-entrancy guard: the submit button is disabled while a
		// submission is in flight, but Enter-key or scripted submissions
		// must not start a second concurrent batch (their create requests
		// would interleave on the server and scramble the list order).
		if (submitting) return
		const duplicateCount = duplicateFileNameCount(orderedEntries)
		if (duplicateCount > 0) {
			toast.add({
				title: t("resources.new.duplicateFileNames", {
					count: duplicateCount,
				}),
				type: "warning",
			})
		}
		if (splitEachFile) {
			await batchSubmit.submit()
			return
		}

		await executeSubmit(values)
	}

	async function executeSubmit(values: FormValues) {
		const activeEntries = displayOrder
			.map((i) => entries[i])
			.filter((e) => e !== undefined)

		if (activeEntries.length === 0) {
			toast.add({
				title: t("resources.new.errors.pickAtLeastOne"),
				type: "error",
			})
			return
		}

		// Files are already staged in the pool; reuse their fileIds in entry
		// order. Submit is gated on staging completion, so a missing fileId
		// means that file failed or timed out.
		const activeFiles = activeEntries
			.map((e) => fileIds[entries.indexOf(e)])
			.filter((id): id is string => typeof id === "string")
		if (activeFiles.length !== activeEntries.length) {
			const failedCount = fileProgresses.filter((p) => p < 0).length
			toast.add({
				title:
					failedCount > 0
						? t("resources.new.errors.stagingFailed", {
								count: failedCount,
							})
						: t("resources.new.errors.uploadFailed"),
				type: "error",
			})
			return
		}

		try {
			const trimmedName = values.name.trim()
			const activeFileObjects = orderedFilesFromEntries(activeEntries)
			const resolvedName = resolveSubmittedResourceName(
				trimmedName,
				activeFileObjects,
			)
			const created = await createMut.mutateAsync(
				buildCreatePayload(
					activeFiles,
					values,
					resolvedName,
					activeFileObjects.map((f) => f.name),
				),
			)
			await finalizeNewResource(created.id)
			watchForDuplicates(created.id)
			await invalidateResources(qc)
			toast.add({ title: t("resources.new.created"), type: "success" })
			setEntries([])
			setDisplayOrder([])
			setCoverCrop(undefined)
			setFormResetNonce((n) => n + 1)
		} catch (err) {
			const message = errorMessage(err, t("resources.new.errors.uploadFailed"))
			toast.add({ title: message, type: "error" })
		}
	}

	const submitting = createMut.isPending || batchSubmit.isSubmitting
	const hasPayload = entries.length > 0
	const splitEachFile = splitOrderedIntoResources && entries.length >= 2

	// Aggregate of per-file staging progress (0–100) for the fixed action
	// bar's progress strip; hidden once staging completes. Failed entries
	// report -1 and are clamped out of the mean.
	const stagedProgress =
		isStaging && fileProgresses.length > 0
			? Math.round(
					(fileProgresses.reduce((sum, p) => sum + Math.max(0, p), 0) /
						fileProgresses.length) *
						100,
				)
			: undefined

	const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0)
	const filesAside =
		entries.length > 0
			? `${entries.length} ${t("resources.new.filesCount")} · ${formatBytes(totalBytes)}`
			: undefined

	return (
		<PageScaffold width="content" bottomPad={false}>
			<PageHeader
				title={t("resources.new.title")}
				description={t("resources.new.description")}
				className="mb-0"
			/>
			<Form {...form}>
				<form
					onSubmit={form.handleSubmit(onSubmit)}
					className="flex flex-col gap-6 pb-24"
				>
					<div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_var(--spacing-panel)]">
						<div className="flex min-w-0 flex-col gap-6">
							<UploadSection
								icon={GalleryWide}
								title={t("resources.new.files")}
								description={t("resources.new.filesDescription")}
								aside={filesAside}
								action={
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => {
											setEntries([])
											setDisplayOrder([])
											setCoverCrop(undefined)
											setFormResetNonce((n) => n + 1)
										}}
										disabled={submitting || entries.length === 0}
										data-testid="upload-clear-all"
									>
										{t("upload.clearAll")}
									</Button>
								}
								data-testid="create-resource-files-section"
							>
								<FileListEditor
									entries={entries}
									displayOrder={displayOrder}
									onEntriesChange={(next) => {
										setEntries(next)
										setDisplayOrder(buildIdentityOrder(next.length))
									}}
									onOrderChange={setDisplayOrder}
									disabled={submitting}
									fileIds={fileIds}
									fileProgresses={fileProgresses}
								/>

								{entries.length >= 2 ? (
									<div className="mt-3 flex flex-col gap-1">
										<label
											htmlFor="create-resource-one-file-per-resource"
											className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
										>
											<Checkbox
												id="create-resource-one-file-per-resource"
												checked={splitOrderedIntoResources}
												onCheckedChange={(v) =>
													setSplitOrderedIntoResources(v === true)
												}
												disabled={submitting}
												data-testid="create-resource-one-file-per-resource"
											/>
											<span>{t("resources.new.oneFilePerResource")}</span>
										</label>
									</div>
								) : undefined}
							</UploadSection>

							<UploadSection
								icon={LinkIcon}
								title={t("resources.new.links")}
								description={t("resources.new.linksDescription")}
								data-testid="create-resource-links-section"
							>
								<div className="flex flex-col">
									<div className="mt-4 flex flex-col first:mt-0">
										<Label className="text-xs font-normal text-secondary-foreground">
											{t("resources.new.tags")}
										</Label>
										<div className="mt-1.5" data-testid="create-resource-tags">
											<DualTagPicker
												value={tagIds}
												onChange={setTagIds}
												kind="resource"
											/>
										</div>
									</div>

									<div className="mt-4 flex flex-col">
										<Label className="text-xs font-normal text-secondary-foreground">
											{t("resources.new.characters")}
										</Label>
										<div
											className="mt-1.5"
											data-testid="create-resource-characters"
										>
											<CharChipsPicker
												ids={charIds}
												onChange={setCharacterIds}
												testId="create-resource-characters-picker"
											/>
										</div>
									</div>

									<div className="mt-4 flex flex-col">
										<Label className="text-xs font-normal text-secondary-foreground">
											{t("resources.new.collections")}
										</Label>
										<div
											className="mt-1.5"
											data-testid="create-resource-collections"
										>
											<ColPicker
												value={selectedCollectionIds}
												onChange={setSelectedCollectionIds}
											/>
										</div>
									</div>
								</div>
							</UploadSection>
						</div>

						<div className="flex min-w-0 flex-col gap-6">
							<UploadSection
								icon={FileText}
								title={t("resources.new.basicInfo")}
								description={t("resources.new.basicDescription")}
								data-testid="create-resource-basic-section"
							>
								<div className="flex flex-col">
									<FormField
										control={form.control}
										name="name"
										render={({ field }) => (
											<FormItem className="flex flex-col gap-0">
												<FormLabel className="text-xs font-normal text-secondary-foreground">
													{t("resources.new.name")}
												</FormLabel>
												<FormControl>
													<Input
														{...field}
														size="lg"
														className="mt-1.5"
														data-testid="create-resource-name"
														autoComplete="off"
														placeholder={t("resources.new.namePlaceholder")}
														maxLength={MAX_NAME_LENGTH}
													/>
												</FormControl>
												<FormMessage className="mt-1.5" />
											</FormItem>
										)}
									/>

									<label
										htmlFor="create-resource-use-filename-name"
										className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
									>
										<Checkbox
											id="create-resource-use-filename-name"
											checked={useFilenameAsName}
											onCheckedChange={(v) => setUseFilenameAsName(v === true)}
											disabled={submitting}
											data-testid="create-resource-use-filename-name"
										/>
										<span>{t("resources.new.useFilenameAsName")}</span>
									</label>

									<FormField
										control={form.control}
										name="contentPluginId"
										render={({ field }) => (
											<FormItem className="mt-4 flex flex-col gap-0">
												<FormLabel className="text-xs font-normal text-secondary-foreground mb-1.5">
													{t("resources.new.plugin")}
												</FormLabel>
												<FormControl>
													<DropdownSelect
														value={field.value ?? ""}
														onValueChange={(value) =>
															field.onChange(value === "" ? null : value)
														}
														data-testid="create-resource-content-type"
														options={pluginOptions}
													/>
												</FormControl>
												<FormMessage className="mt-1.5" />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="intro"
										render={({ field: _field }) => (
											<FormItem className="mt-4 flex flex-col gap-0">
												<FormLabel className="text-xs font-normal text-secondary-foreground">
													{t("resources.new.intro")}
												</FormLabel>
												<FormControl>
													<Textarea
														data-testid="create-resource-intro"
														rows={4}
														placeholder={t("resources.new.introPlaceholder")}
														className="mt-1.5 min-h-[100px]"
														maxLength={MAX_INTRO_LENGTH}
													/>
												</FormControl>
												<FormMessage className="mt-1.5" />
											</FormItem>
										)}
									/>

									<FormField
										control={form.control}
										name="sourceName"
										render={({ field }) => (
											<FormItem className="mt-4 flex flex-col gap-0">
												<FormLabel className="text-xs font-normal text-secondary-foreground">
													{t("resources.new.sourceName")}
												</FormLabel>
												<FormControl>
													<Input
														{...field}
														size="lg"
														className="mt-1.5"
														data-testid="create-resource-source-name"
														autoComplete="off"
														list={SOURCE_NAME_DATALIST_ID}
														placeholder={t(
															"resources.new.sourceNamePlaceholder",
														)}
														maxLength={MAX_SOURCE_NAME_LENGTH}
													/>
												</FormControl>
												<FormMessage className="mt-1.5" />
											</FormItem>
										)}
									/>
									<SourceNameSuggest />
									<FormField
										control={form.control}
										name="sourceUrl"
										render={({ field }) => (
											<FormItem className="mt-4 flex flex-col gap-0">
												<FormLabel className="text-xs font-normal text-secondary-foreground">
													{t("resources.new.sourceUrl")}
												</FormLabel>
												<FormControl>
													<Input
														{...field}
														size="lg"
														className="mt-1.5"
														data-testid="create-resource-source-url"
														autoComplete="off"
														placeholder={t(
															"resources.new.sourceUrlPlaceholder",
														)}
														maxLength={MAX_URL_LENGTH}
													/>
												</FormControl>
												<FormMessage className="mt-1.5" />
											</FormItem>
										)}
									/>
									<p className="mt-4 text-xs text-muted-foreground">
										{t("resources.new.sourceHint")}
									</p>
								</div>
							</UploadSection>

							<UploadSection
								icon={Gallery}
								title={t("resources.new.cover")}
								description={t("resources.new.coverDescription")}
								data-testid="create-resource-cover-section"
							>
								<ImageCropPanel
									key={formResetNonce}
									previewShape="square"
									cropStageWidth={280}
									cropStageHeight={280}
									hideActionButton
									autoSaveOnCrop
									hidePreview
									fillWidth
									onSave={async (cropped) => {
										setCoverCrop(cropped)
									}}
								/>
							</UploadSection>
						</div>
					</div>

					<FixedActionBar progress={stagedProgress}>
						<Button
							type="submit"
							data-testid="create-resource-submit"
							disabled={
								submitting || !hasPayload || (!splitEachFile && isStaging)
							}
						>
							{submitting || isStaging
								? t("resources.new.uploading")
								: t("resources.new.submit")}
						</Button>
					</FixedActionBar>
				</form>
			</Form>
		</PageScaffold>
	)
}
