import { Button } from "@hoardodile/ui/components/button"
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
import { Fragment, useState } from "react"
import { useTranslation } from "react-i18next"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { SettingsSheet } from "@/features/settings/SettingsSheet"
import { useToastMutation } from "@/hooks/useToastMutation"
import { hardResetAndReload } from "@/lib/client-reset"
import { trpcMutation } from "@/trpc/factory"
import { dataHistoryListQueryOptions, switchVersionMutation } from "./api"
import { CreateArchiveDialog } from "./CreateArchiveDialog"
import { DataHistoryDetail } from "./DataHistoryDetail"
import { DataHistoryTimeline } from "./DataHistoryTimeline"

export function DataHistoryPanel({
	embedded = false,
}: {
	embedded?: boolean
} = {}) {
	const Sheet = embedded ? Fragment : SettingsSheet
	const { t } = useTranslation()
	const listQuery = useQuery(dataHistoryListQueryOptions())
	const [selectedId, setSelectedId] = useState<string>()
	const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
	const switchConfirm = useConfirmDialog<number>()
	const create = useToastMutation({
		...trpcMutation("protection", "archive"),
		errorToastKey: "dataHistory.toast.archiveFailed",
		onSuccess: () => setArchiveDialogOpen(false),
	})
	const select = useToastMutation({
		...switchVersionMutation(),
		errorToastKey: "dataHistory.toast.switchFailed",
		onSuccess: () => {
			switchConfirm.close()
			void hardResetAndReload(t("dataHistory.reloading"))
		},
	})
	const readOnly =
		listQuery.data &&
		listQuery.data.activeVersion !== listQuery.data.currentVersion
	const status = listQuery.data ? (
		<p className="text-xs text-muted-foreground" data-testid="archive-status">
			{t(
				readOnly
					? "dataHistory.status.viewingArchive"
					: "dataHistory.status.currentWritable",
				{ version: listQuery.data.activeVersion },
			)}
		</p>
	) : null
	return (
		<div className="flex flex-col">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-4">
				{embedded ? (
					(status ?? <span aria-hidden="true" />)
				) : (
					<h2 className="text-ui font-medium">{t("protection.archives")}</h2>
				)}
				<Button
					variant="secondary"
					onClick={() => setArchiveDialogOpen(true)}
					disabled={create.isPending || Boolean(readOnly)}
					data-testid="create-archive"
				>
					<Icon icon={Archive} />
					{t("dataHistory.action.archiveNow")}
				</Button>
			</div>
			{!embedded && status}
			<Sheet>
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
					{(data) => {
						// The detail pane opens on the latest (current) archive so
						// the browser never starts with an empty selection; a manual
						// pick overrides it until the panel remounts.
						const detailId =
							selectedId ??
							data.archives.find((archive) => archive.current)?.id ??
							data.archives[0]?.id
						return (
							<div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_var(--spacing-sidebar)]">
								<div className="min-w-0">
									<DataHistoryTimeline
										data={data}
										selectedId={detailId}
										onSelect={setSelectedId}
									/>
								</div>
								<div className="min-w-0">
									<DataHistoryDetail
										data={data}
										selectedId={detailId}
										onSwitchVersion={switchConfirm.open}
										isSwitching={select.isPending}
									/>
								</div>
							</div>
						)
					}}
				</QueryStateView>
			</Sheet>
			<CreateArchiveDialog
				open={archiveDialogOpen}
				onOpenChange={setArchiveDialogOpen}
				onConfirm={(input) => create.mutate(input)}
				pending={create.isPending}
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
		</div>
	)
}
