import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core"
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { PluginManifest, PluginPermissions } from "@hoardodile/sdk-types"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Icon, type IconType } from "@hoardodile/ui/components/icon"
import {
	IconToggle,
	type IconToggleOption,
} from "@hoardodile/ui/components/icon-toggle"
import { Label } from "@hoardodile/ui/components/label"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Switch } from "@hoardodile/ui/components/switch"
import { toast } from "@hoardodile/ui/components/toast"
import {
	Archive,
	ChatRound,
	ChatRoundLine,
	Database,
	Download,
	Eraser,
	Eye,
	File,
	Gallery,
	GalleryWide,
	HamburgerMenu,
	ListVertical,
	Magnifier,
	MenuDots,
	Pin,
	PlugCircle,
	Refresh,
	Restart,
	Sun,
	TestTube,
	TrashBinMinimalistic,
	Upload,
	Widget2,
} from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { keyBy } from "es-toolkit"
import {
	type ChangeEvent,
	type CSSProperties,
	useEffect,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import { ColorPicker } from "@/components/common/ColorPicker"
import { SearchField } from "@/components/common/SearchField"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { isMinAppSatisfied } from "@/features/marketplace/compat"
import type { MarketPlugin } from "@/features/marketplace/MarketplaceDetailDialog"
import { MarketplaceDetailDialog } from "@/features/marketplace/MarketplaceDetailDialog"
import {
	marketplaceConfigQueryOptions,
	marketplaceSnapshotQueryOptions,
} from "@/features/marketplace/marketplaceApi"
import {
	pushCacheChanged,
	pushPrefsChanged,
} from "@/features/plugin/iframe/pushes"
import { useToastMutation } from "@/hooks/useToastMutation"
import { APP_VERSION } from "@/lib/appInfo"
import { errorMessage } from "@/lib/errors"
import type { RouterOutputs } from "@/trpc/client"
import { PluginTileIcon } from "./icons/plugin-tile-icon"
import {
	renderSearchKindLabel,
	resolveManifestDescription,
	resolveManifestName,
} from "./manifestText"
import {
	grantedPermissionKeys,
	PluginPermissionBadges,
} from "./PluginPermissionBadges"
import { PluginUninstallDialog } from "./PluginUninstallDialog"
import { readPluginZipManifest } from "./plugin-zip-preview"
import {
	pluginCacheRemoveAllByPluginMutation,
	pluginCacheRemoveAllMutation,
	pluginKeys,
	pluginListAllQueryOptions,
	pluginPrefRemoveAllByPluginMutation,
	pluginPrefRemoveAllMutation,
	pluginReorderMutation,
	pluginRescanMutation,
	pluginUpdateMutation,
	uploadPlugin,
} from "./pluginApi"
import { matchesPluginQuery } from "./pluginFilter"

export { PluginUninstallDialog } from "./PluginUninstallDialog"

type PluginView = "list" | "grid"

type PluginRowData = RouterOutputs["plugin"]["listAll"][number]

/** In-repo plugin ids → tile icon; anything else falls back to PlugCircle. */
const pluginIcons: Record<string, IconType> = {
	"665cfbdd-1db6-48f5-9d53-1008b8cb84c3": GalleryWide,
	"a1b2c3d4-e5f6-7890-abcd-ef1234567890": File,
}

/** Permission → quiet icon mark. Full names ride on the tooltip; the row
    never wraps for metadata. */
const permissionMeta: Record<
	keyof PluginPermissions,
	{ readonly icon: IconType }
> = {
	sourceMeta: { icon: Database },
	searchMeta: { icon: Magnifier },
	danmaku: { icon: ChatRoundLine },
	message: { icon: ChatRound },
	imageHashes: { icon: Gallery },
	container: { icon: Archive },
	download: { icon: Download },
}

/**
 * Page-level actions — install from a .zip bundle (with the manifest
 * consent dialog) and rescan the plugins folder. Sits above the sheet,
 * the same rhythm as the Data page.
 */
export function PluginPageActions() {
	const { t, i18n } = useTranslation()
	const qc = useQueryClient()
	const [isUploading, setUploading] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const installConfirm = useConfirmDialog<{
		file: File
		manifest: PluginManifest
	}>()

	const rescanMut = useToastMutation({
		...pluginRescanMutation(),
		invalidate: (qc) => qc.invalidateQueries({ queryKey: pluginKeys.all }),
		successToastKey: "plugins.rescanSuccess",
		errorToastKey: "common.error",
	})

	function handleUploadClick() {
		fileInputRef.current?.click()
	}

	async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0]
		if (file === undefined) return
		// Reset immediately so picking the same file again (e.g. after
		// cancelling the dialog) re-triggers onChange.
		if (fileInputRef.current !== null) {
			fileInputRef.current.value = ""
		}
		// Preview the manifest and ask for explicit consent first: a plugin
		// is server-side code, so installing must never be one-click.
		try {
			const manifest = await readPluginZipManifest(file)
			if (!isMinAppSatisfied(manifest)) {
				toast.add({
					title: t("marketplace.incompatibleAppVersion", {
						require: manifest.minAppVersion ?? "",
						current: APP_VERSION,
					}),
					type: "error",
				})
				return
			}
			installConfirm.open({ file, manifest })
		} catch {
			toast.add({ title: t("plugins.uploadInvalidPlugin"), type: "error" })
		}
	}

	async function handleInstallConfirm() {
		const target = installConfirm.target
		if (target === undefined) return
		setUploading(true)
		try {
			const form = new FormData()
			form.append("archive", target.file)
			await uploadPlugin(form)
			await qc.invalidateQueries({ queryKey: pluginKeys.all })
			toast.add({ title: t("plugins.uploadPluginSuccess"), type: "success" })
			installConfirm.close()
		} catch (err) {
			toast.add({
				title: errorMessage(err, t("common.error")),
				type: "error",
			})
		} finally {
			setUploading(false)
		}
	}

	return (
		<>
			<div className="mb-3 flex items-center justify-start gap-2">
				<input
					ref={fileInputRef}
					type="file"
					accept=".zip"
					className="hidden"
					onChange={handleFileChange}
					data-testid="plugin-upload-input"
				/>
				<Button
					onClick={handleUploadClick}
					disabled={isUploading}
					data-testid="plugin-upload"
				>
					<Icon icon={Upload} />
					{t("plugins.uploadZip")}
				</Button>
				<Button
					variant="secondary"
					onClick={() => rescanMut.mutate(undefined)}
					disabled={rescanMut.isPending}
					data-testid="plugin-rescan"
				>
					<Icon
						icon={Refresh}
						className={rescanMut.isPending ? "animate-spin" : ""}
					/>
					{t("plugins.rescan")}
				</Button>
			</div>
			<p className="mb-3 -mt-2 text-tiny text-muted-foreground">
				{t("plugins.pageHint")}
			</p>

			<ConfirmDialog
				open={installConfirm.isOpen}
				onOpenChange={installConfirm.onOpenChange}
				title={t("plugins.installConfirmTitle")}
				confirmLabel={t("plugins.install")}
				pendingLabel={t("plugins.uploading")}
				isPending={isUploading}
				onConfirm={() => void handleInstallConfirm()}
				confirmTestId="plugin-install-confirm"
				body={
					installConfirm.target !== undefined ? (
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-2.5">
								<PluginTileIcon
									iconRef={installConfirm.target.manifest.icon}
									pluginId={installConfirm.target.manifest.id}
									fallback={PlugCircle}
								/>
								<div className="flex flex-col gap-0.5">
									<span className="text-sm font-medium">
										{resolveManifestName(
											installConfirm.target.manifest,
											i18n.language,
										)}
										<span className="ml-2 text-xs font-normal text-muted-foreground">
											v{installConfirm.target.manifest.version}
										</span>
									</span>
									<span className="font-mono text-xs text-muted-foreground">
										{installConfirm.target.manifest.id}
									</span>
								</div>
							</div>
							<PluginPermissionBadges
								permissions={installConfirm.target.manifest.permissions}
							/>
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t("plugins.installConfirmRisk")}
							</p>
						</div>
					) : undefined
				}
			/>
		</>
	)
}

/**
 * Installed plugins — the priority list that decides who claims content.
 * Filter field narrows it, grid/list toggle switches the anatomy; only
 * the list rows carry the drag grip, so reordering happens there.
 */
export function InstalledPluginsPanel() {
	const { t, i18n } = useTranslation()
	const qc = useQueryClient()
	const listQuery = useQuery(pluginListAllQueryOptions())
	// Marketplace metadata for the "details" menu entry; the snapshot
	// shares its query key with the marketplace page (one fetch).
	const configQuery = useQuery(marketplaceConfigQueryOptions())
	const registryRepo = configQuery.data?.registryRepo ?? null
	const marketQuery = useQuery({
		...marketplaceSnapshotQueryOptions(),
		enabled: registryRepo !== null,
	})
	const [view, setView] = useState<PluginView>("grid")
	const [query, setQuery] = useState("")
	const [detailPlugin, setDetailPlugin] = useState<MarketPlugin | null>(null)
	const [uninstallPlugin, setUninstallPlugin] = useState<PluginRowData | null>(
		null,
	)

	const updateMut = useToastMutation({
		...pluginUpdateMutation(),
		invalidate: (qc) => qc.invalidateQueries({ queryKey: pluginKeys.all }),
		errorToastKey: "common.error",
	})

	const reorderMut = useMutation({
		...pluginReorderMutation(),
		onMutate: async ({ ids }) => {
			await qc.cancelQueries({ queryKey: pluginKeys.listAll() })
			const previous = qc.getQueryData<RouterOutputs["plugin"]["listAll"]>(
				pluginKeys.listAll(),
			)
			if (previous !== undefined) {
				qc.setQueryData(pluginKeys.listAll(), reorderListByIds(previous, ids))
			}
			return { previous }
		},
		onError: (err, _input, ctx) => {
			if (ctx?.previous !== undefined) {
				qc.setQueryData(pluginKeys.listAll(), ctx.previous)
			}
			void qc.invalidateQueries({ queryKey: pluginKeys.all })
			toast.add({
				title: errorMessage(err, t("common.error")),
				type: "error",
			})
		},
	})

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	const viewOptions: readonly IconToggleOption<PluginView>[] = [
		{ value: "list", icon: ListVertical, label: t("plugins.listView") },
		{ value: "grid", icon: Widget2, label: t("plugins.gridView") },
	]

	const plugins = listQuery.data ?? []
	const nonBuiltinPlugins = plugins.filter((p) => !p.builtin)
	const marketById = new Map(
		(marketQuery.data?.plugins ?? []).map((plugin) => [plugin.id, plugin]),
	)
	const filteredPlugins = nonBuiltinPlugins.filter((p) =>
		matchesPluginQuery(
			{
				id: p.id,
				name: resolveManifestName(p.manifest, i18n.language),
				description: resolveManifestDescription(p.manifest, i18n.language),
			},
			query,
		),
	)

	function handleToggleEnabled(id: string, enabled: boolean) {
		updateMut.mutate({ id, enabled })
	}

	function handleSaveAppearance(
		id: string,
		patch: { readonly pinned: boolean; readonly color: string },
	) {
		updateMut.mutate({ id, ...patch })
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event
		if (over === null || active.id === over.id) return
		const currentIds = filteredPlugins.map((p) => p.id)
		const oldIndex = currentIds.indexOf(String(active.id))
		const newIndex = currentIds.indexOf(String(over.id))
		if (oldIndex < 0 || newIndex < 0) return
		const nextIds = arrayMove([...currentIds], oldIndex, newIndex)
		reorderMut.mutate({ ids: nextIds })
	}

	if (listQuery.isPending) {
		return (
			<p className="text-sm text-muted-foreground">{t("common.loading")}</p>
		)
	}

	return (
		<div>
			<div className="flex items-center justify-between gap-2">
				<SearchField
					value={query}
					onCommit={setQuery}
					placeholder={t("plugins.filterPlaceholder")}
					className="w-60"
					testId="plugin-filter"
				/>
				<div className="flex items-center gap-3">
					<span className="text-xs text-muted-foreground">
						{t("plugins.countInstalled", {
							count: nonBuiltinPlugins.length,
						})}
					</span>
					<IconToggle options={viewOptions} value={view} onChange={setView} />
				</div>
			</div>
			{/* Full-bleed rows on the sheet — no card inside the card.
			    The list caps its height and scrolls, so an install with
			    dozens of plugins never stretches the page. */}
			{view === "grid" ? (
				<div className="strip-scroll -mx-8 mt-3 max-h-[340px] overflow-y-auto border-t border-border px-8 pt-4 pb-1">
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{filteredPlugins.map((p, i) => (
							<PluginCard
								key={p.id}
								p={p}
								priority={i + 1}
								marketPlugin={marketById.get(p.id)}
								onToggleEnabled={handleToggleEnabled}
								onSaveAppearance={handleSaveAppearance}
								onShowDetails={setDetailPlugin}
							/>
						))}
					</div>
				</div>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={filteredPlugins.map((p) => p.id)}
						strategy={verticalListSortingStrategy}
					>
						<div className="strip-scroll -mx-8 mt-3 max-h-[340px] divide-y divide-border overflow-y-auto border-t border-border">
							{filteredPlugins.map((p, i) => (
								<SortablePluginRow
									key={p.id}
									p={p}
									priority={i + 1}
									marketPlugin={marketById.get(p.id)}
									onToggleEnabled={handleToggleEnabled}
									onSaveAppearance={handleSaveAppearance}
									onShowDetails={setDetailPlugin}
									disabled={reorderMut.isPending}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}

			{detailPlugin !== null && (
				<MarketplaceDetailDialog
					open
					plugin={detailPlugin}
					installed={plugins.find((p) => p.id === detailPlugin.id)}
					onOpenChange={(open) => {
						if (!open) setDetailPlugin(null)
					}}
					onInstall={() => setDetailPlugin(null)}
					onUninstall={() => {
						const row = plugins.find((p) => p.id === detailPlugin.id)
						setDetailPlugin(null)
						if (row !== undefined) setUninstallPlugin(row)
					}}
				/>
			)}
			{uninstallPlugin !== null && (
				<PluginUninstallDialog
					pluginId={uninstallPlugin.id}
					pluginName={resolveManifestName(
						uninstallPlugin.manifest,
						i18n.language,
					)}
					open
					onOpenChange={(open) => {
						if (!open) setUninstallPlugin(null)
					}}
				/>
			)}
		</div>
	)
}

/**
 * "Plugin defaults" — every plugin's settings return to their defaults;
 * content and installs stay untouched.
 */
export function PluginDefaultsPanel() {
	const { t } = useTranslation()
	const confirm = useConfirmDialog<true>()
	const mut = useToastMutation({
		...pluginPrefRemoveAllMutation(),
		successToastKey: "plugins.resetAllPluginPrefSuccess",
		errorToastKey: "common.error",
		onSuccess: () => pushPrefsChanged(),
	})

	return (
		<>
			<Button
				variant="destructive"
				onClick={() => confirm.open(true)}
				disabled={mut.isPending}
				data-testid="plugin-reset-all"
			>
				<Icon icon={Restart} />
				{t("plugins.restore")}
			</Button>
			<ConfirmDialog
				open={confirm.isOpen}
				onOpenChange={confirm.onOpenChange}
				title={t("plugins.resetAllPluginPrefConfirmTitle")}
				description={t("plugins.resetAllPluginPrefConfirmDescription")}
				confirmLabel={t("plugins.restore")}
				pendingLabel={t("common.working")}
				isPending={mut.isPending}
				destructive
				onConfirm={() => mut.mutate(undefined)}
			/>
		</>
	)
}

/**
 * "Plugin caches" — thumbnails and parsed metadata across all plugins,
 * rebuilt on demand.
 */
export function PluginCachesPanel() {
	const { t } = useTranslation()
	const confirm = useConfirmDialog<true>()
	const mut = useToastMutation({
		...pluginCacheRemoveAllMutation(),
		successToastKey: "plugins.clearAllPluginCacheSuccess",
		errorToastKey: "common.error",
		onSuccess: () => pushCacheChanged(),
	})

	return (
		<>
			<Button
				variant="destructive"
				onClick={() => confirm.open(true)}
				disabled={mut.isPending}
				data-testid="plugin-clear-all"
			>
				<Icon icon={Eraser} />
				{t("plugins.clearAll")}
			</Button>
			<ConfirmDialog
				open={confirm.isOpen}
				onOpenChange={confirm.onOpenChange}
				title={t("plugins.clearAllPluginCacheConfirmTitle")}
				description={t("plugins.clearAllPluginCacheConfirmDescription")}
				confirmLabel={t("plugins.clearAll")}
				pendingLabel={t("common.working")}
				isPending={mut.isPending}
				destructive
				onConfirm={() => mut.mutate(undefined)}
			/>
		</>
	)
}

/** The built-in File plugin — always on, never reordered or removed. */
export function FilePluginPill() {
	const { t } = useTranslation()
	const listQuery = useQuery(pluginListAllQueryOptions())
	const builtin = listQuery.data?.find((p) => p.builtin)
	return (
		<span
			className="inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-2 text-tiny text-secondary-foreground"
			data-testid="plugin-file-pill"
		>
			{builtin !== undefined ? `v${builtin.manifest.version} · ` : ""}
			{t("plugins.alwaysOn")}
		</span>
	)
}

/** Icon marks shown before the grant set folds into a "+N" chip — leaving
    room for the dev/missing state badges on the same row. */
const PERMISSION_MARKS_VISIBLE = 3

/** Declared permissions as bare icon marks — tooltips carry the full
    names. Search metadata also counts the plugin's own sub-categories;
    its chip opens them as a popover. Shared by the row and grid-card
    layouts — and by the marketplace cards (which pass no manifest, so
    the search-categories popover simply does not apply). Beyond
    {@link PERMISSION_MARKS_VISIBLE} the rest fold into a "+N" chip so
    neither a row nor a narrow card can overflow. */
export function PermissionMarks({
	p,
}: {
	readonly p: {
		readonly id: string
		readonly permissions: PluginPermissions
		/** Presence enables the search-categories popover (needs manifest i18n). */
		readonly manifest?: PluginManifest
	}
}) {
	const { t, i18n } = useTranslation()
	const granted = grantedPermissionKeys(p.permissions)
	if (granted.length === 0) return null
	const manifest = p.manifest
	const kinds = manifest?.ui?.search?.kinds ?? []
	const visible = granted.slice(0, PERMISSION_MARKS_VISIBLE)
	const overflowed = granted.slice(PERMISSION_MARKS_VISIBLE)
	return (
		<div className="flex shrink-0 items-center gap-1">
			{visible.map((key) => {
				const meta = permissionMeta[key]
				const kindCount = key === "searchMeta" ? kinds.length : 0
				if (kindCount === 0 || manifest === undefined) {
					return (
						<span
							key={key}
							title={t(`plugins.permissions.${key}`)}
							className="flex size-5 items-center justify-center text-muted-foreground"
						>
							<Icon icon={meta.icon} size="sm" />
						</span>
					)
				}
				return (
					<Popover key={key}>
						<PopoverTrigger
							nativeButton={false}
							render={
								<span
									title={t(`plugins.permissions.${key}`)}
									className="flex h-5 cursor-pointer items-center gap-1 rounded-md bg-muted px-1.5 text-tiny tabular-nums text-secondary-foreground"
								>
									<Icon icon={meta.icon} size="sm" />
									{kindCount}
								</span>
							}
						/>
						<PopoverContent className="w-44 rounded-xl border border-border bg-card p-3 text-foreground shadow-card ring-0 gap-0">
							<SectionLabel size="tiny">
								{t("plugins.searchCategories")}
							</SectionLabel>
							<span className="mt-2 flex flex-wrap gap-1">
								{kinds.map((kind) => (
									<MetaChip key={kind.key}>
										{renderSearchKindLabel(kind, manifest, p.id, i18n.language)}
									</MetaChip>
								))}
							</span>
						</PopoverContent>
					</Popover>
				)
			})}
			{overflowed.length > 0 ? (
				<span
					title={overflowed
						.map((key) => t(`plugins.permissions.${key}`))
						.join(", ")}
					className="flex size-5 items-center justify-center rounded-full bg-muted text-tiny tabular-nums text-muted-foreground"
				>
					+{overflowed.length}
				</span>
			) : null}
		</div>
	)
}

/** Dev/missing state badges, shared by rows and cards. */
function StateBadges({ p }: { p: PluginRowData }) {
	const { t } = useTranslation()
	return (
		<>
			{p.dev ? (
				<span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-tiny text-secondary-foreground">
					<Icon icon={TestTube} size="sm" />
					{t("plugins.dev")}
				</span>
			) : null}
			{p.missing ? (
				<span className="inline-flex h-5 shrink-0 items-center rounded-full border border-dashed border-border-strong px-2 text-tiny text-muted-foreground">
					{t("plugins.missingSource")}
				</span>
			) : null}
		</>
	)
}

/** List mode — one line per plugin: identity, permission marks, an
    inline-truncated description and the standing actions. The grip and
    priority number live on the left; the row is draggable in list mode. */
function SortablePluginRow(props: {
	readonly p: PluginRowData
	readonly priority: number
	readonly marketPlugin?: MarketPlugin
	readonly onToggleEnabled: (id: string, enabled: boolean) => void
	readonly onSaveAppearance: (
		id: string,
		patch: { readonly pinned: boolean; readonly color: string },
	) => void
	readonly onShowDetails: (plugin: MarketPlugin) => void
	readonly disabled: boolean
}) {
	const { p, priority, onToggleEnabled, onSaveAppearance, disabled } = props
	const { t, i18n } = useTranslation()

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: p.id,
		disabled: disabled,
		transition: null,
	})

	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		zIndex: isDragging ? 10 : undefined,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={`group flex items-center gap-3 px-8 py-2.5 transition-colors hover:bg-accent/40 ${isDragging ? "opacity-50" : ""}`}
			data-testid={`plugin-row-${p.id}`}
		>
			{/* Drag grip + priority — order decides who claims a bundle first. */}
			<div className="flex w-9 shrink-0 items-center gap-1.5">
				<button
					type="button"
					disabled={disabled}
					aria-label={t("plugins.dragToReorder")}
					{...attributes}
					{...listeners}
					className="flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:opacity-30"
				>
					<Icon icon={HamburgerMenu} size="sm" />
				</button>
				<span className="text-xs tabular-nums text-muted-foreground">
					{priority}
				</span>
			</div>
			<PluginTileIcon
				iconRef={p.manifest.icon}
				pluginId={p.id}
				fallback={pluginIcons[p.id] ?? PlugCircle}
			/>
			<div className="flex min-w-0 shrink-0 items-center gap-2">
				<span className="truncate text-ui font-medium">
					{resolveManifestName(p.manifest, i18n.language)}
				</span>
				<span className="shrink-0 font-mono text-tiny text-muted-foreground">
					v{p.manifest.version}
				</span>
				<StateBadges p={p} />
			</div>
			<PermissionMarks
				p={{
					id: p.id,
					permissions: p.manifest.permissions,
					manifest: p.manifest,
				}}
			/>
			<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
				{resolveManifestDescription(p.manifest, i18n.language)}
			</p>
			{/* Row actions stay minimal — brand color, per-plugin reset and
			    cache clearing all live in the More menu; only the switch
			    earns a permanent spot. */}
			<div className="flex shrink-0 items-center gap-0.5">
				<PluginRowActions
					plugin={p}
					marketPlugin={props.marketPlugin}
					onShowDetails={props.onShowDetails}
					onSaveAppearance={onSaveAppearance}
				/>
				<Switch
					checked={p.enabled}
					onCheckedChange={(checked) => onToggleEnabled(p.id, checked)}
					aria-label={t("plugins.enableToggle")}
					data-testid={`plugin-toggle-${p.id}`}
				/>
			</div>
		</div>
	)
}

/** Grid mode — one card per plugin, still sheet-flat (border, no fill). */
function PluginCard(props: {
	readonly p: PluginRowData
	readonly priority: number
	readonly marketPlugin?: MarketPlugin
	readonly onToggleEnabled: (id: string, enabled: boolean) => void
	readonly onSaveAppearance: (
		id: string,
		patch: { readonly pinned: boolean; readonly color: string },
	) => void
	readonly onShowDetails: (plugin: MarketPlugin) => void
}) {
	const { p, priority, onToggleEnabled, onSaveAppearance } = props
	const { t, i18n } = useTranslation()
	return (
		<div
			className="flex flex-col gap-2.5 rounded-xl border border-border p-4 transition-colors hover:bg-accent/40"
			data-testid={`plugin-row-${p.id}`}
		>
			<div className="flex items-center gap-2.5">
				<PluginTileIcon
					iconRef={p.manifest.icon}
					pluginId={p.id}
					fallback={pluginIcons[p.id] ?? PlugCircle}
				/>
				<div className="min-w-0 flex-1">
					<span className="block truncate text-ui font-medium">
						{resolveManifestName(p.manifest, i18n.language)}
					</span>
					<span className="block truncate font-mono text-tiny text-muted-foreground">
						v{p.manifest.version} · #{priority}
					</span>
				</div>
				<Switch
					checked={p.enabled}
					onCheckedChange={(checked) => onToggleEnabled(p.id, checked)}
					aria-label={t("plugins.enableToggle")}
					data-testid={`plugin-toggle-${p.id}`}
				/>
			</div>
			<p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
				{resolveManifestDescription(p.manifest, i18n.language)}
			</p>
			{/* Badges ride the bottom row — the header meta line is too narrow
			    to hold them next to the version. */}
			<div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
				<PermissionMarks
					p={{
						id: p.id,
						permissions: p.manifest.permissions,
						manifest: p.manifest,
					}}
				/>
				<StateBadges p={p} />
				<span className="ml-auto shrink-0">
					<PluginRowActions
						plugin={p}
						marketPlugin={props.marketPlugin}
						onShowDetails={props.onShowDetails}
						onSaveAppearance={onSaveAppearance}
					/>
				</span>
			</div>
		</div>
	)
}

/** The More menu — appearance (color/pin), per-plugin settings reset,
    per-plugin cache clear and uninstall. */
function PluginRowActions(props: {
	readonly plugin: PluginRowData
	readonly marketPlugin?: MarketPlugin
	readonly onShowDetails: (plugin: MarketPlugin) => void
	readonly onSaveAppearance: (
		id: string,
		patch: { readonly pinned: boolean; readonly color: string },
	) => void
}) {
	const { plugin, marketPlugin, onShowDetails, onSaveAppearance } = props
	const { t, i18n } = useTranslation()

	const prefResetMut = useMutation({
		...pluginPrefRemoveAllByPluginMutation(),
		onSuccess: () => {
			pushPrefsChanged()
			toast.add({
				title: t("plugins.resetPluginPrefSuccess", {
					name: resolveManifestName(plugin.manifest, i18n.language),
				}),
				type: "success",
			})
		},
		onError: (err) => {
			toast.add({
				title: errorMessage(err, t("common.error")),
				type: "error",
			})
		},
	})

	const cacheClearMut = useMutation({
		...pluginCacheRemoveAllByPluginMutation(),
		onSuccess: () => {
			pushCacheChanged()
			toast.add({
				title: t("plugins.clearPluginCacheSuccess", {
					name: resolveManifestName(plugin.manifest, i18n.language),
				}),
				type: "success",
			})
		},
		onError: (err) => {
			toast.add({
				title: errorMessage(err, t("common.error")),
				type: "error",
			})
		},
	})

	const resetConfirm = useConfirmDialog<"pref" | "cache">()
	const [appearanceOpen, setAppearanceOpen] = useState(false)
	const [uninstallOpen, setUninstallOpen] = useState(false)

	function handleResetPref() {
		resetConfirm.open("pref")
	}

	function handleClearCache() {
		resetConfirm.open("cache")
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							className="size-7"
							aria-label={t("plugins.more")}
							data-testid={`plugin-menu-${plugin.id}`}
						>
							<Icon icon={MenuDots} size="sm" />
						</Button>
					}
				/>
				<DropdownMenuContent align="end" className="w-44">
					{marketPlugin !== undefined && (
						<DropdownMenuItem
							onClick={() => onShowDetails(marketPlugin)}
							data-testid={`plugin-menu-detail-${plugin.id}`}
						>
							<Icon icon={Eye} />
							{t("marketplace.details")}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onClick={() => setAppearanceOpen(true)}>
						<Icon icon={Sun} />
						{t("plugins.appearance")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={handleResetPref}
						disabled={prefResetMut.isPending}
						variant="destructive"
					>
						<Icon icon={Restart} />
						{t("plugins.resetPluginPref")}
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={handleClearCache}
						disabled={cacheClearMut.isPending}
						variant="destructive"
					>
						<Icon icon={Eraser} />
						{t("plugins.clearPluginCache")}
					</DropdownMenuItem>
					{!plugin.builtin && !plugin.dev ? (
						<DropdownMenuItem
							onClick={() => setUninstallOpen(true)}
							variant="destructive"
						>
							<Icon icon={TrashBinMinimalistic} />
							{t("plugins.uninstall")}
						</DropdownMenuItem>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>

			<PluginAppearanceDialog
				plugin={plugin}
				open={appearanceOpen}
				onOpenChange={setAppearanceOpen}
				onSave={(patch) => onSaveAppearance(plugin.id, patch)}
			/>

			<ConfirmDialog
				open={resetConfirm.isOpen}
				onOpenChange={resetConfirm.onOpenChange}
				title={
					resetConfirm.target === "pref"
						? t("plugins.resetPluginPrefConfirmTitle", {
								name: resolveManifestName(plugin.manifest, i18n.language),
							})
						: t("plugins.clearPluginCacheConfirmTitle", {
								name: resolveManifestName(plugin.manifest, i18n.language),
							})
				}
				description={
					resetConfirm.target === "pref"
						? t("plugins.resetPluginPrefConfirmDescription", {
								name: resolveManifestName(plugin.manifest, i18n.language),
							})
						: t("plugins.clearPluginCacheConfirmDescription", {
								name: resolveManifestName(plugin.manifest, i18n.language),
							})
				}
				confirmLabel={
					resetConfirm.target === "pref"
						? t("plugins.reset")
						: t("plugins.clear")
				}
				pendingLabel={t("common.working")}
				isPending={
					resetConfirm.target === "pref"
						? prefResetMut.isPending
						: cacheClearMut.isPending
				}
				destructive
				onConfirm={() => {
					if (resetConfirm.target === "pref") {
						prefResetMut.mutate({ pluginId: plugin.id })
					} else {
						cacheClearMut.mutate({ pluginId: plugin.id })
					}
				}}
			/>

			{/* The uninstall confirmation must sit OUTSIDE the dropdown
			    content — Radix unmounts the menu on item select, which
			    would instantly close a dialog rendered inside it. */}
			<PluginUninstallDialog
				pluginId={plugin.id}
				pluginName={resolveManifestName(plugin.manifest, i18n.language)}
				open={uninstallOpen}
				onOpenChange={setUninstallOpen}
			/>
		</>
	)
}

function PluginAppearanceDialog(props: {
	readonly plugin: {
		readonly id: string
		readonly manifest: PluginManifest
		readonly pinned: boolean
		readonly color: string
	}
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onSave: (patch: {
		readonly pinned: boolean
		readonly color: string
	}) => void
}) {
	const { plugin, open, onOpenChange, onSave } = props
	const { t, i18n } = useTranslation()
	const [draft, setDraft] = useState({
		pinned: plugin.pinned,
		color: plugin.color,
	})

	useEffect(() => {
		if (open) setDraft({ pinned: plugin.pinned, color: plugin.color })
	}, [open, plugin.pinned, plugin.color])

	const footer = (
		<>
			<Button variant="secondary" onClick={() => onOpenChange(false)}>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				onClick={() => {
					onSave(draft)
					onOpenChange(false)
				}}
			>
				{t("common.save")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("plugins.appearanceTitle", {
				name: resolveManifestName(plugin.manifest, i18n.language),
			})}
			description={t("plugins.appearanceDescription")}
			footer={footer}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<Label>{t("plugins.color")}</Label>
					<ColorPicker
						value={draft.color}
						onChange={(color) => setDraft((d) => ({ ...d, color }))}
					/>
				</div>
				<Label
					htmlFor="plugin-appearance-pin"
					className="inline-flex w-fit items-center gap-2 py-2"
				>
					<Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
					<span className="text-sm">{t("plugins.pin")}</span>
					<Switch
						id="plugin-appearance-pin"
						checked={draft.pinned}
						onCheckedChange={(pinned) => setDraft((d) => ({ ...d, pinned }))}
						size="sm"
					/>
				</Label>
			</div>
		</AppDialog>
	)
}

function reorderListByIds(
	rows: Readonly<RouterOutputs["plugin"]["listAll"]>,
	ids: readonly string[],
): RouterOutputs["plugin"]["listAll"] {
	const nonBuiltin = rows.filter((r) => !r.builtin)
	const builtin = rows.filter((r) => r.builtin)
	const byId = keyBy(nonBuiltin, (r) => r.id)
	const reordered: typeof nonBuiltin = []
	for (const id of ids) {
		const r = byId[id]
		if (r !== undefined) reordered.push(r)
	}
	return [...reordered, ...builtin]
}
