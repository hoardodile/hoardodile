import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Archive } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation } from "@/trpc/factory"
import { dataHistoryListQueryOptions } from "./api"
import { CreateArchiveDialog } from "./CreateArchiveDialog"

/**
 * Page-level action for the archives tab — the same slot as the plugins
 * page's upload bar: one primary button plus a quiet hint, sitting
 * OUTSIDE the settings section. The archive is created instantly from
 * the latest version; name and description come later through the
 * current version's edit dialog.
 */
export function ArchivePageActions() {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const listQuery = useQuery(dataHistoryListQueryOptions())
	const readOnly =
		listQuery.data &&
		listQuery.data.activeVersion !== listQuery.data.currentVersion
	const create = useToastMutation({
		...trpcMutation("protection", "archive"),
		errorToastKey: "dataHistory.toast.archiveFailed",
		onSuccess: () => setOpen(false),
	})

	return (
		<>
			<div className="mb-3 flex items-center justify-start gap-2">
				<Button
					onClick={() => setOpen(true)}
					disabled={create.isPending || Boolean(readOnly)}
					data-testid="create-archive"
				>
					<Icon icon={Archive} />
					{t("dataHistory.action.archiveNow")}
				</Button>
			</div>
			<p className="mb-3 -mt-2 text-tiny text-muted-foreground">
				{t("dataHistory.pageHint")}
			</p>
			<CreateArchiveDialog
				open={open}
				onOpenChange={setOpen}
				onConfirm={() => create.mutate({})}
				pending={create.isPending}
			/>
		</>
	)
}
