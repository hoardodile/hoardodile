import { ForbiddenCircle } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { memo } from "react"
import { useTranslation } from "react-i18next"

export type DocStatusBarProps = {
	readonly charCount: number
	readonly maxCharCount: number
	/** Network is unreachable: edits are staged locally until reconnect. */
	readonly offline: boolean
}

const WARN_RATIO = 0.9

/**
 * Slim status bar rendered below the editor body: a hairline that
 * quietly fills toward the character ceiling, with the tabular count
 * at its right. The fill (and count) shift to amber past 90 % of the
 * limit and to the destructive tone once it is exceeded, giving the
 * user a clear signal before the save pipeline blocks.
 */
export const DocStatusBar = memo(function DocStatusBar(
	props: DocStatusBarProps,
) {
	const { charCount, maxCharCount, offline } = props
	const { t } = useTranslation()
	const ratio = maxCharCount > 0 ? charCount / maxCharCount : 0
	const isOver = ratio >= 1
	const isWarn = !isOver && ratio >= WARN_RATIO
	const percent = Math.min(100, ratio * 100)

	return (
		<div
			className="flex flex-col gap-1.5 pb-2 pt-5"
			data-testid="document-status-bar"
		>
			<div className="relative h-px w-full overflow-hidden bg-border/50">
				<div
					className={cn(
						"absolute inset-y-0 left-0 transition-[width] duration-500 ease-out",
						isOver
							? "bg-destructive"
							: isWarn
								? "bg-amber-500"
								: "bg-primary/60",
					)}
					style={{ width: `${percent}%` }}
				/>
			</div>
			<div
				className={cn(
					"flex items-center justify-end gap-3 text-xs tabular-nums",
					isOver
						? "text-destructive"
						: isWarn
							? "text-amber-500"
							: "text-muted-foreground",
				)}
			>
				{offline && (
					<span
						className="flex items-center gap-1 font-medium text-amber-500"
						data-testid="document-offline-indicator"
					>
						<ForbiddenCircle className="size-3" strokeWidth={1.8} />
						{t("documents.statusBar.offline")}
					</span>
				)}
				<span className="ml-auto">
					{t("documents.statusBar.charCount", {
						count: charCount.toLocaleString(),
						max: maxCharCount.toLocaleString(),
					})}
				</span>
			</div>
		</div>
	)
})
