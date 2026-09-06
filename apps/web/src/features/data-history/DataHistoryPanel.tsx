import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@hoardodile/ui/components/empty"
import { Icon } from "@hoardodile/ui/components/icon"
import { QueryStateView } from "@hoardodile/ui/components/query-state-view"
import { Archive } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { useToastMutation } from "@/hooks/useToastMutation"
import { hardResetAndReload } from "@/lib/client-reset"
import type { ArchiveEvent } from "./api"
import {
	dataHistoryKeys,
	dataHistoryListQueryOptions,
	switchVersionMutation,
	updateVersionMetaMutation,
} from "./api"
import { DataHistoryTimeline } from "./DataHistoryTimeline"
import { EditArchiveDialog } from "./EditArchiveDialog"

/**
 * Archives browser — one row per version with the actions on it (edit
 * for the current, switch for the rest). The route owns the page-level
 * action bar and the section wrapper; this component is pure content.
 */
export function DataHistoryPanel() {
	const { t } = useTranslation()
	const listQuery = useQuery(dataHistoryListQueryOptions())
	const [editing, setEditing] = useState<ArchiveEvent | null>(null)
	const switchConfirm = useConfirmDialog<number>()
	const updateMeta = useToastMutation({
		...updateVersionMetaMutation(),
		invalidate: (qc) =>
			qc.invalidateQueries({ queryKey: dataHistoryKeys.list() }),
		successToastKey: "dataHistory.toast.metaSaved",
		errorToastKey: "dataHistory.toast.metaSaveFailed",
	})
	const select = useToastMutation({
		...switchVersionMutation(),
		errorToastKey: "dataHistory.toast.switchFailed",
		onSuccess: () => {
			switchConfirm.close()
			void hardResetAndReload(t("dataHistory.reloading"))
		},
	})
	return (
		<>
			<QueryStateView
				result={listQuery}
				isEmpty={(data) => data.archives.length === 0}
				loading={<p>{t("common.loading")}</p>}
				empty={
					<Empty className="py-8">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Icon icon={Archive} className="size-6" />
							</EmptyMedia>
							<EmptyTitle data-testid="data-history-empty">
								{t("dataHistory.empty.title")}
							</EmptyTitle>
						</EmptyHeader>
					</Empty>
				}
			>
				{(data) => (
					<DataHistoryTimeline
						data={data}
						onSwitchVersion={switchConfirm.open}
						onEdit={setEditing}
						isSwitching={select.isPending}
					/>
				)}
			</QueryStateView>
			<EditArchiveDialog
				archive={editing}
				open={editing !== null}
				onOpenChange={(open) => {
					if (!open) setEditing(null)
				}}
				onSave={(patch) => {
					if (editing === null) return
					updateMeta.mutate({ version: editing.version, ...patch })
				}}
				pending={updateMeta.isPending}
			/>
			{switchConfirm.target !== undefined && (
				<ConfirmDialog
					open={switchConfirm.isOpen}
					onOpenChange={switchConfirm.onOpenChange}
					title={t("dataHistory.confirm.switchTitle")}
					description={t("dataHistory.confirm.switchDescription")}
					confirmLabel={t("dataHistory.action.switchToVersion")}
					pendingLabel={t("common.working")}
					isPending={select.isPending}
					onConfirm={() => {
						if (switchConfirm.target !== undefined)
							select.mutate(switchConfirm.target)
					}}
					confirmTestId="switch-confirm-submit"
				/>
			)}
		</>
	)
}
