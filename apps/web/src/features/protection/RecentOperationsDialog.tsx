import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { PaginationBar } from "@hoardodile/ui/components/pagination-bar"
import { pageCountOf } from "@hoardodile/ui/lib/pagination"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { protectionJobsOptions } from "./api"
import { ProtectionJobs } from "./ProtectionJobs"

/** Jobs per page in the recent-operations dialog. */
const RECENT_OPERATIONS_PAGE_SIZE = 5

/**
 * The job history behind the Backups page's row button: the same list the
 * page used to render inline, windowed at five rows with a single pager at
 * the bottom. Retry / cancel / technical details stay with their rows
 * ({@link ProtectionJobs}), so nothing here duplicates the actions.
 */
export function RecentOperationsDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { t } = useTranslation()
	const jobs = useQuery(protectionJobsOptions())
	const jobsCount = jobs.data?.length ?? 0
	const pageCount = pageCountOf(jobsCount, RECENT_OPERATIONS_PAGE_SIZE)
	const [page, setPage] = useState(1)
	// Jobs are pruned and replaced as they finish, so clamp instead of
	// stranding the user on a page that no longer exists.
	const currentPage = Math.min(page, pageCount)
	const firstIndex = (currentPage - 1) * RECENT_OPERATIONS_PAGE_SIZE

	return (
		<AppDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			title={t("protection.jobs")}
			description={t("protectionUx.jobsHelp")}
			size="lg"
			contentTestId="recent-operations-dialog"
		>
			<div className="flex flex-col">
				<ProtectionJobs
					showHeading={false}
					visibleRange={[firstIndex, firstIndex + RECENT_OPERATIONS_PAGE_SIZE]}
				/>
				{pageCount > 1 ? (
					<div className="mt-4">
						<PaginationBar
							page={currentPage}
							pageCount={pageCount}
							onChangePage={setPage}
							totalLabel={t("protectionUx.recentOperationsCount", {
								count: jobsCount,
							})}
						/>
					</div>
				) : null}
			</div>
		</AppDialog>
	)
}
