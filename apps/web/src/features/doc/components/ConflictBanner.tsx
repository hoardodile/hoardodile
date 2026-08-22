import { Button } from "@hoardodile/ui/components/button"
import { BranchingPathsUp, DangerTriangle } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { memo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { useDateFormatter } from "@/features/settings/datePrefs"

export type ConflictBannerProps = {
	readonly onKeepOffline: () => void
	readonly onKeepRemote: () => void
	readonly onViewDiff: () => void
	readonly keepPending: boolean
	/** Server draft updatedAt at the moment the conflict latched. */
	readonly remoteUpdatedAt: number | undefined
	/** When the local edits were last written to the cache. */
	readonly localModifiedAt: number | undefined
}

/**
 * Fixed overlay banner shown while an offline conflict is unresolved. The
 * editor keeps showing the offline content; the user decides which side
 * wins, or inspects the diff first. There is intentionally no dismiss
 * button — leaving without a choice keeps both sides safe and the banner
 * returns on the next visit.
 *
 * "Discard current" requires an explicit confirmation: while a conflict is
 * pending, autosave is suspended and the cached content is the only copy
 * of the recent keystrokes.
 */
export const ConflictBanner = memo(function ConflictBanner(
	props: ConflictBannerProps,
) {
	const { t } = useTranslation()
	const formatter = useDateFormatter()
	const [discardOpen, setDiscardOpen] = useState(false)
	const showTimestamps =
		props.remoteUpdatedAt !== undefined && props.localModifiedAt !== undefined

	return (
		<>
			<div
				className="doc-banner fixed inset-x-0 top-0 z-30 px-3 pt-3"
				data-testid="doc-conflict-banner"
			>
				<div
					role="alert"
					className={cn(
						"mx-auto flex w-full max-w-content flex-col gap-y-2.5",
						"rounded-2xl border bg-card p-3 shadow-card",
					)}
				>
					<div className="flex items-start gap-2.5">
						<DangerTriangle
							className="mt-0.5 size-4 shrink-0 text-secondary-foreground"
							strokeWidth={1.8}
						/>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium">
								{t("documents.conflict.title")}
							</p>
							<p className="text-xs text-muted-foreground">
								{t("documents.conflict.description")}
							</p>
							{showTimestamps && (
								<p
									className="mt-0.5 text-xs text-muted-foreground"
									data-testid="doc-conflict-timestamps"
								>
									{t("documents.conflict.updatedHint", {
										remote: formatter.formatDateTime(props.remoteUpdatedAt!),
										local: formatter.formatDateTime(props.localModifiedAt!),
									})}
								</p>
							)}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2.5"
							onClick={props.onViewDiff}
							data-testid="doc-conflict-view-diff"
						>
							<BranchingPathsUp className="size-3.5" strokeWidth={1.6} />
							<span className="ml-1.5">{t("documents.conflict.viewDiff")}</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-2.5"
							onClick={() => setDiscardOpen(true)}
							data-testid="doc-conflict-discard-current"
						>
							{t("documents.conflict.discardCurrent")}
						</Button>
						<Button
							variant="default"
							size="sm"
							className="h-7 px-2.5"
							onClick={props.onKeepOffline}
							disabled={props.keepPending}
							data-testid="doc-conflict-keep-current"
						>
							{t("documents.conflict.keepCurrent")}
						</Button>
					</div>
				</div>
			</div>
			<ConfirmDialog
				open={discardOpen}
				onOpenChange={setDiscardOpen}
				title={t("documents.conflict.discardConfirm.title")}
				description={t("documents.conflict.discardConfirm.description")}
				confirmLabel={t("documents.conflict.discardConfirm.confirm")}
				isPending={false}
				destructive
				onConfirm={() => {
					setDiscardOpen(false)
					props.onKeepRemote()
				}}
				confirmTestId="doc-conflict-keep-remote"
			/>
		</>
	)
})
