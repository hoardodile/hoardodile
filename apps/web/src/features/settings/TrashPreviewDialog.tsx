import { Icon } from "@hoardodile/ui/components/icon"
import {
	AltArrowLeft,
	AltArrowRight,
	Download,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ResPreviewDialog } from "@/features/res/components/ResPreviewDialog"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { type TrashItem, trashDownloadUrl } from "./api"

export type TrashPreviewDialogProps = {
	readonly items: readonly TrashItem[]
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}

export function TrashPreviewDialog(props: TrashPreviewDialogProps) {
	const { items, open, onOpenChange } = props
	const { t } = useTranslation()
	const { formatDateTime } = useDateFormatter()
	const [index, setIndex] = useState(0)

	const current = items[index]

	function close() {
		onOpenChange(false)
		setIndex(0)
	}

	function goPrev() {
		if (index > 0) setIndex((i) => i - 1)
	}

	function goNext() {
		if (index < items.length - 1) setIndex((i) => i + 1)
	}

	if (current === undefined || !open) return null

	const canPrev = index > 0
	const canNext = index < items.length - 1

	// Entry names are opaque (`resources-<id>-<ts>`), so the rail labels
	// entries by their trash timestamp instead.
	const sideBar = (
		<nav
			className="flex w-44 flex-col gap-0.5 p-2"
			data-testid="trash-entry-rail"
		>
			{items.map((item, i) => (
				<button
					key={item.name}
					type="button"
					onClick={() => setIndex(i)}
					data-testid={`trash-entry-${i}`}
					className={cn(
						"rounded-md px-2 py-1.5 text-left text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white",
						i === index && "bg-white/15 text-white",
					)}
				>
					{item.trashedAt !== undefined
						? formatDateTime(item.trashedAt)
						: item.name}
				</button>
			))}
		</nav>
	)

	const bottomBar = (
		<div className="flex items-center justify-between gap-2 px-3 py-2">
			<div className="flex items-center gap-2">
				<button
					type="button"
					disabled={!canPrev}
					onClick={goPrev}
					aria-label={t("common.prev")}
					className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-30"
				>
					<Icon icon={AltArrowLeft} className="size-5" />
				</button>
				<button
					type="button"
					disabled={!canNext}
					onClick={goNext}
					aria-label={t("common.next")}
					className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-30"
				>
					<Icon icon={AltArrowRight} className="size-5" />
				</button>
				<span className="text-xs text-white/80">
					{index + 1} / {items.length}
				</span>
			</div>
			<a
				href={trashDownloadUrl(current.name)}
				download
				className="flex h-8 items-center gap-1 rounded-full bg-black/60 px-3 text-xs text-white transition-colors hover:bg-black/80"
			>
				<Download className="size-4" />
				{t("me.trash.download")}
			</a>
		</div>
	)

	return (
		<ResPreviewDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close()
			}}
			resId={current.originalId ?? current.name}
			resName={current.name}
			contentPluginId={current.contentPluginId ?? ""}
			sourceMeta={{}}
			searchMeta={undefined}
			fileStats={current.fileStats}
			bottomBar={bottomBar}
			sideBar={sideBar}
		/>
	)
}
