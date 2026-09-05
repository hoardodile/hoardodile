import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { protectionJobsOptions } from "./api"

export function FileWriteNotice() {
	const { t } = useTranslation()
	const jobs = useQuery(protectionJobsOptions())
	const pending = jobs.data?.some(
		(job) =>
			job.kind === "file-write" &&
			["queued", "running", "cancelling"].includes(job.state),
	)
	if (!pending) return null
	return (
		<div
			role="status"
			className="border-b border-border bg-muted px-5 py-2 text-xs"
		>
			{t("protection.waitingFiles")}{" "}
			<Link to="/settings/backups" className="underline">
				{t("protection.manageQueue")}
			</Link>
		</div>
	)
}
