import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { Progress } from "@hoardodile/ui/components/progress"
import { QueryStateView } from "@hoardodile/ui/components/query-state-view"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Spinner } from "@hoardodile/ui/components/spinner"
import { toast } from "@hoardodile/ui/components/toast"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import {
	Bolt,
	Eraser,
	InfoCircle,
	Restart,
} from "@hoardodile/ui/icons/registry"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { charKeys } from "@/features/char"
import { resKeys } from "@/features/res"
import { resListCardsQueryOptions } from "@/features/res/api"
import { clearCache } from "@/features/settings/api"
import { usePrecache } from "@/features/settings/use-precache"
import { formatBytes } from "@/lib/formatBytes"
import type { StorageOverview } from "./api"
import { storageKeys, storageOverviewQueryOptions } from "./api"
import { buildStorageSegments, type StorageSegment } from "./segments"

/**
 * Storage accounting panel: how much disk space the archive occupies and
 * where it went. Volume stats come from the filesystem, the category
 * breakdown from a server-side scan (memoized ~60s) plus per-plugin
 * resource metadata. The allocation bar and legend group segments by
 * owner; the Cache group header owns the Precache/Clear pair and the
 * running precache strip sits beneath the legend.
 */
export function StoragePanel() {
	const { t } = useTranslation()
	const query = useQuery(storageOverviewQueryOptions())
	const precache = usePrecache()

	return (
		<QueryStateView
			result={query}
			loading={
				<div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
					{t("common.loading")}
				</div>
			}
		>
			{(overview) => (
				<StorageBreakdown overview={overview} precache={precache} />
			)}
		</QueryStateView>
	)
}

function StorageBreakdown(props: {
	readonly overview: StorageOverview
	readonly precache: ReturnType<typeof usePrecache>
}) {
	const { overview, precache } = props
	const { t } = useTranslation()
	const [clearOpen, setClearOpen] = useState(false)
	const [clearing, setClearing] = useState(false)
	const queryClient = useQueryClient()

	const resourcesCountQuery = useQuery(
		resListCardsQueryOptions({
			query: "",
			page: 1,
			size: 1,
			sortBy: "updated",
			order: "desc",
		}),
	)
	const resourcesCount = resourcesCountQuery.data?.total

	const mounted = useRef(false)
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true
			void precache.resumeIfRunning()
		}
	}, [precache.resumeIfRunning])

	const { state, start, abort } = precache
	const checking = state.status === "checking"
	const streaming = state.status === "streaming"
	const warming = state.status === "warming"
	const busy = streaming || warming
	const finished = state.status === "done"
	const precacheBusy = checking || streaming || warming

	async function handlePrecache() {
		const result = await start()
		if (result === null) return

		await Promise.all([
			queryClient.invalidateQueries({ queryKey: resKeys.all }),
			queryClient.invalidateQueries({ queryKey: charKeys.all }),
		])

		const failed = result.resources.failed + result.characters.failed
		if (failed > 0) {
			toast.add({
				title: t("overview.toastPrecachePartial", { failed }),
				type: "warning",
			})
		} else {
			toast.add({
				title: t("overview.toastPrecacheSuccess", {
					count: result.resources.total + result.characters.total,
				}),
				type: "success",
			})
		}
	}

	async function handleAbort() {
		const ok = await abort()
		if (ok) {
			toast.add({ title: t("overview.precacheAborted"), type: "info" })
		}
	}

	async function handleClearCache() {
		setClearing(true)
		try {
			const { failed } = await clearCache()
			if (failed.length > 0) {
				// Entries locked by running processes stay behind; the server
				// reports them by name. Not an error worth blocking on.
				console.warn("cache entries could not be cleared:", failed)
			}
			await queryClient.invalidateQueries({
				queryKey: storageKeys.overview(),
			})
			setClearOpen(false)
		} finally {
			setClearing(false)
		}
	}

	const segments = buildStorageSegments(overview, t)
	const totalBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0)
	const archivedSegments = segments.filter(
		(segment) => segment.group === "archived",
	)
	const volume = overview.volume
	const usedRatio =
		volume !== null && volume.totalBytes > 0
			? Math.min(1, overview.usedBytes / volume.totalBytes)
			: undefined
	const precacheTotal = warming ? state.warming.total : state.progress.total
	const precacheCurrent = warming ? state.warming.done : state.progress.current
	const precachePercent =
		precacheTotal === 0
			? 0
			: Math.round((precacheCurrent / precacheTotal) * 100)
	const precacheStage = warming
		? t("overview.caching")
		: (state.progress.phase ?? t("overview.precacheStageLoading"))

	return (
		<div className="flex flex-col">
			{overview.lowSpace ? (
				<div
					className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
					data-testid="storage-low-space"
				>
					{t("storage.lowSpaceBanner")}
				</div>
			) : null}

			{/* Status strip — usage of the whole volume, then the quiet counts. */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<span className="text-ui font-medium text-foreground tabular-nums">
					{volume !== null ? (
						<>
							{formatBytes(overview.usedBytes)}
							<span className="font-normal text-muted-foreground">
								{" "}
								/ {formatBytes(volume.totalBytes)}
							</span>
						</>
					) : (
						t("storage.volumeUnavailable")
					)}
				</span>
				{usedRatio !== undefined ? (
					<span className="w-32 shrink-0">
						<Progress
							value={usedRatio * 100}
							aria-label={t("storage.volumeUsed")}
						>
							<span className="sr-only">
								{t("storage.volumeUsed")} {formatBytes(overview.usedBytes)}
							</span>
						</Progress>
					</span>
				) : null}
				{volume !== null ? (
					<span className="ml-auto text-xs text-muted-foreground tabular-nums">
						{t("storage.volumeFree")} {formatBytes(volume.freeBytes)}
						{resourcesCount !== undefined ? (
							<>
								<span className="mx-1.5">·</span>
								{t("resources.search.itemCount", { count: resourcesCount })}
							</>
						) : null}
					</span>
				) : null}
			</div>

			{/* Allocation bar — one segment per owner, floored so thin shares
			    stay visible. */}
			{segments.length > 0 ? (
				<div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-muted">
					{segments.map((segment) => (
						<span
							key={segment.id}
							title={`${segment.label} — ${formatBytes(segment.bytes)}`}
							className="h-full first:rounded-l-full last:rounded-r-full"
							style={{
								backgroundColor: segment.color,
								width: `${Math.max(
									(segment.bytes / totalBytes) * 100,
									MIN_SEGMENT_PERCENT,
								)}%`,
							}}
						/>
					))}
				</div>
			) : null}

			{/* Legend — dot + name, size right-aligned, two columns. Group
			    headers carry the extra chrome: "Latest" on Resources, the
			    Precache/Clear pair on Cache. */}
			<div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-1.5">
				<LegendGroupLabel
					badge={t("storage.legend.latest")}
					badgeTone="inverse"
				>
					{t("storage.legend.resources")}
				</LegendGroupLabel>
				{segments
					.filter((segment) => segment.group === "plugins")
					.map((segment) => (
						<LegendRow key={segment.id} segment={segment} />
					))}
				<LegendGroupLabel>{t("storage.legend.hostData")}</LegendGroupLabel>
				{segments
					.filter((segment) => segment.group === "host")
					.map((segment) => (
						<LegendRow key={segment.id} segment={segment} />
					))}
				{archivedSegments.length > 0 ? (
					<>
						<LegendGroupLabel>
							{t("storage.legend.archivedVersions")}
						</LegendGroupLabel>
						{archivedSegments.map((segment) => (
							<LegendRow key={segment.id} segment={segment} />
						))}
					</>
				) : null}
				<LegendGroupLabel
					actions={
						<span className="flex items-center gap-2">
							<Button
								onClick={() => {
									void handlePrecache()
								}}
								disabled={busy || checking}
								data-testid="precache-thumbnails"
							>
								{checking ? (
									<Spinner aria-hidden="true" />
								) : (
									<Icon icon={Bolt} />
								)}
								{busy
									? t("overview.precaching")
									: finished
										? t("overview.refreshCache")
										: t("overview.precache")}
							</Button>
							<Button
								variant="destructive"
								onClick={() => setClearOpen(true)}
								disabled={clearing || precacheBusy}
								data-testid="storage-clear-cache"
							>
								<Icon icon={Eraser} />
								{t("storage.clearCache")}
							</Button>
						</span>
					}
				>
					{t("storage.legend.cache")}
				</LegendGroupLabel>
				{segments
					.filter((segment) => segment.group === "cache")
					.map((segment) => (
						<LegendRow key={segment.id} segment={segment} />
					))}
			</div>

			{/* The precaching run — progress against the full library, with
			    abort. Lives under the legend because the cache blocks (whose
			    group header carries the Precache/Clear pair) are its output. */}
			{(busy || finished) && !state.conflict ? (
				<div className="mt-4 flex items-center gap-3 rounded-xl bg-muted px-4 py-3">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-secondary-foreground">
						<Icon icon={Bolt} />
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex items-baseline justify-between gap-3">
							<span className="text-ui font-medium text-foreground">
								{t("overview.precaching")}
							</span>
							<span
								className="shrink-0 text-xs text-muted-foreground tabular-nums"
								data-testid="precache-thumbnails-status"
							>
								{precacheCurrent.toLocaleString()} /{" "}
								{precacheTotal.toLocaleString()} · {precachePercent}%
							</span>
						</div>
						<div className="mt-2">
							<Progress value={precachePercent} />
						</div>
						<p className="mt-1 text-tiny text-muted-foreground">
							{precacheStage}
						</p>
					</div>
					{streaming ? (
						<Button
							variant="secondary"
							className="shrink-0"
							onClick={() => {
								void handleAbort()
							}}
							data-testid="abort-precache"
						>
							<Icon icon={Restart} />
							{t("overview.abortPrecache")}
						</Button>
					) : null}
				</div>
			) : null}

			{state.status === "error" ? (
				<p className="mt-3 text-xs text-destructive">
					{state.conflict
						? t("overview.precacheInProgress")
						: t("overview.precacheFailed", {
								error: state.error ?? t("overview.precacheDefaultError"),
							})}
				</p>
			) : null}

			{/* Total line — the bar's own accounting. */}
			<div className="mt-5 flex items-baseline justify-between border-t border-border pt-3">
				<span className="text-xs text-muted-foreground">
					{t("storage.usedByHoardodile")}
				</span>
				<span className="text-ui font-medium text-foreground tabular-nums">
					{formatBytes(overview.usedBytes)}
					{volume !== null ? (
						<span className="font-normal text-muted-foreground">
							{" "}
							/ {formatBytes(volume.totalBytes)}
						</span>
					) : null}
				</span>
			</div>

			<ConfirmDialog
				open={clearOpen}
				onOpenChange={setClearOpen}
				title={t("storage.clearCacheTitle")}
				description={t("storage.clearCacheDescription")}
				confirmLabel={t("storage.clearCache")}
				pendingLabel={t("common.working")}
				isPending={clearing}
				onConfirm={handleClearCache}
				confirmTestId="storage-clear-confirm"
			/>
		</div>
	)
}

/** Segments thinner than this share would vanish — floor them so the
    legend's promise (there *is* cache, trash…) stays visible. */
const MIN_SEGMENT_PERCENT = 0.8

/** Uppercase section label spanning both legend columns; the cache one
    gains its Precache/Clear pair on the right, the resources one a
    "Latest" badge (same anatomy as the Archive page's version badge). */
function LegendGroupLabel(props: {
	readonly children: ReactNode
	readonly badge?: string
	readonly badgeTone?: "muted" | "inverse"
	readonly actions?: ReactNode
}) {
	const { children, badge, badgeTone = "muted", actions } = props
	return (
		<SectionLabel className="col-span-2 mt-2 flex items-center gap-2 first:mt-0">
			{children}
			{badge !== undefined ? (
				<MetaChip tone={badgeTone}>{badge}</MetaChip>
			) : null}
			{actions !== undefined && (
				<span className="ml-auto flex items-center gap-2">{actions}</span>
			)}
		</SectionLabel>
	)
}

function LegendRow({ segment }: { readonly segment: StorageSegment }) {
	return (
		<span
			className="flex h-control items-center gap-2.5"
			data-testid={`storage-${segment.id}`}
		>
			<span
				className="size-2 shrink-0 rounded-full"
				style={{ backgroundColor: segment.color }}
			/>
			<span className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="flex min-w-0 items-center gap-1 truncate text-ui text-foreground">
					<span className="truncate">{segment.label}</span>
					{segment.tip !== undefined && (
						<Tooltip>
							<TooltipTrigger
								render={
									<span className="shrink-0 cursor-help text-muted-foreground" />
								}
							>
								<Icon icon={InfoCircle} />
							</TooltipTrigger>
							<TooltipContent>{segment.tip}</TooltipContent>
						</Tooltip>
					)}
				</span>
				{segment.subLabel !== undefined && (
					<span className="truncate text-tiny text-muted-foreground">
						{segment.subLabel}
					</span>
				)}
			</span>
			<span className="shrink-0 text-ui text-foreground tabular-nums">
				{formatBytes(segment.bytes)}
			</span>
		</span>
	)
}
