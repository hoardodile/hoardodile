import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { loose } from "@/i18n"
import { trpcMutation } from "@/trpc/factory"
import { protectionJobsOptions } from "./api"
import { JobProgress } from "./JobProgress"
import { jobErrorKey } from "./job-error"

export function ProtectionJobs({
	activeOnly = false,
	restoreOnly = false,
	showHeading = true,
}: {
	activeOnly?: boolean
	restoreOnly?: boolean
	/** Set when a wrapping SettingsSection already supplies the title. */
	showHeading?: boolean
} = {}) {
	const { t } = useTranslation()
	const tr = loose(t)
	const query = useQuery(protectionJobsOptions())
	const [failedError, setFailedError] = useState<{
		code: string
		message: string
	} | null>(null)
	const qc = useQueryClient()
	const invalidate = async () => {
		await qc.invalidateQueries({ queryKey: ["protection"] })
	}
	const cancel = useToastMutation({
		...trpcMutation("protection", "cancel"),
		onSuccess: invalidate,
	})
	const retry = useToastMutation({
		...trpcMutation("protection", "retry"),
		onSuccess: invalidate,
	})
	const visibleJobs = query.data
		?.filter((job) => {
			if (restoreOnly && job.kind !== "restore") return false
			if (
				activeOnly &&
				["failed", "interrupted"].includes(job.state) &&
				query.data?.some(
					(next) => next.kind === job.kind && next.createdAt > job.createdAt,
				)
			)
				return false
			return (
				!activeOnly ||
				["queued", "running", "cancelling", "failed", "interrupted"].includes(
					job.state,
				)
			)
		})
		.slice(0, activeOnly ? 3 : 15)
	if (activeOnly && !visibleJobs?.length) return null
	return (
		<section className="space-y-3" aria-label={t("protection.jobs")}>
			{showHeading && (
				<h3 className="text-ui font-medium">
					{t(activeOnly ? "protectionUx.activity" : "protection.jobs")}
				</h3>
			)}
			{query.data?.length === 0 && (
				<p className="text-xs text-muted-foreground">
					{t("protection.noJobs")}
				</p>
			)}
			<div className="divide-y divide-border">
				{visibleJobs?.map((job) => {
					const running =
						job.state === "running" ||
						job.state === "queued" ||
						job.state === "cancelling"
					return (
						<div
							key={job.id}
							className="flex items-center gap-3 py-3"
							data-testid={`protection-job-${job.id}`}
						>
							<div className="min-w-0 flex-1">
								<p className="text-ui">
									{tr(`protection.kind.${job.kind}`, {
										defaultValue: job.kind,
									})}
								</p>
								<p className="text-xs text-muted-foreground">
									{t(`protection.state.${job.state}`)} ·{" "}
									{new Date(job.createdAt).toLocaleString()}
								</p>
								<JobProgress value={job.progress} />
								{running && (
									<p className="mt-1 text-xs text-secondary-foreground">
										{t(
											job.kind === "restore"
												? "protectionUx.restoreWorking"
												: "protectionUx.keepReading",
										)}
									</p>
								)}
								{job.kind === "file-write" &&
									!running &&
									job.state !== "succeeded" && (
										<p className="mt-1 text-xs">
											{t("protection.resubmitFile")}
										</p>
									)}
								{job.error && (
									<div className="mt-1 text-xs" role="alert">
										<p>{t(jobErrorKey(job.error))}</p>
										<Button
											variant="secondary"
											size="xs"
											className="mt-1"
											onClick={() => setFailedError(job.error ?? null)}
											data-testid={`protection-job-details-${job.id}`}
										>
											{t("protectionUx.errorDetails")}
										</Button>
									</div>
								)}
							</div>
							{running ? (
								<Button
									variant="secondary"
									disabled={cancel.isPending || job.state === "cancelling"}
									onClick={() => cancel.mutate({ id: job.id })}
								>
									{t("protection.cancel")}
								</Button>
							) : (
								job.state !== "succeeded" &&
								job.kind !== "file-write" &&
								job.kind !== "damaged-record" && (
									<Button
										variant="secondary"
										disabled={retry.isPending}
										onClick={() => retry.mutate({ id: job.id })}
									>
										{t("protection.retry")}
									</Button>
								)
							)}
						</div>
					)
				})}
			</div>
			<AppDialog
				open={failedError !== null}
				onOpenChange={(open) => {
					if (!open) setFailedError(null)
				}}
				title={t("protectionUx.errorDetails")}
				description={failedError ? t(jobErrorKey(failedError)) : undefined}
				size="lg"
			>
				<p className="break-words text-xs">{failedError?.message}</p>
			</AppDialog>
		</section>
	)
}
