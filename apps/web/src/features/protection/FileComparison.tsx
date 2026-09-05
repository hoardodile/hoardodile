import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { trpcMutation, trpcQueryOptions } from "@/trpc/factory"

type Difference = { path: string; status: "missing" | "changed" | "extra" }
function isDifference(value: unknown): value is Difference {
	return Boolean(
		value &&
			typeof value === "object" &&
			"path" in value &&
			typeof value.path === "string" &&
			"status" in value &&
			(value.status === "missing" ||
				value.status === "changed" ||
				value.status === "extra"),
	)
}

export function FileComparison(props: {
	jobId: string
	pointId: string
	repositoryId: string
}) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [page, setPage] = useState(0)
	const [plan, setPlan] = useState<{ id: string; files: string[] } | null>(null)
	const query = useQuery({
		...trpcQueryOptions({
			namespace: "protection",
			procedure: "job",
			input: { id: props.jobId },
			queryKey: ["protection", "comparison", props.jobId],
		}),
		refetchInterval: (current) =>
			current.state.data &&
			["succeeded", "failed", "cancelled"].includes(current.state.data.state)
				? false
				: 1000,
	})
	const differences = Array.isArray(query.data?.result)
		? query.data.result.filter(isDifference)
		: []
	const prepare = useToastMutation({
		...trpcMutation("protection", "prepareRepair"),
		onSuccess: setPlan,
	})
	const repair = useToastMutation({
		...trpcMutation("protection", "repair"),
		onSuccess: async () => {
			setPlan(null)
			setSelected(new Set())
			await qc.invalidateQueries({ queryKey: ["protection", "jobs"] })
		},
	})
	return (
		<section className="space-y-3" aria-label={t("protection.differences")}>
			<h3 className="text-ui font-medium">
				{t("protection.differences")} · {differences.length}
			</h3>
			{query.data?.state === "succeeded" && differences.length === 0 && (
				<p className="text-xs">{t("protection.noDifferences")}</p>
			)}
			{query.data?.error && (
				<p role="alert" className="text-xs">
					{query.data.error.message}
				</p>
			)}
			<div className="divide-y divide-border">
				{differences.slice(page * 100, (page + 1) * 100).map((entry) => (
					<label
						key={entry.path}
						className="flex items-center gap-3 py-2 text-xs"
					>
						<input
							type="checkbox"
							aria-label={`${t("protection.repair")}: ${entry.path}`}
							checked={selected.has(entry.path)}
							disabled={
								entry.status === "extra" ||
								/\.sqlite(?:-wal|-shm)?$/i.test(entry.path) ||
								(!selected.has(entry.path) && selected.size >= 1000)
							}
							onChange={(event) =>
								setSelected((previous) => {
									const next = new Set(previous)
									if (event.target.checked) next.add(entry.path)
									else next.delete(entry.path)
									return next
								})
							}
						/>
						<span className="min-w-0 flex-1 break-all">{entry.path}</span>
						<span className="shrink-0 text-muted-foreground">
							{t(`protection.${entry.status}`)}
						</span>
					</label>
				))}
			</div>
			<div className="flex items-center gap-2">
				<Button
					variant="secondary"
					disabled={page === 0}
					onClick={() => setPage(page - 1)}
					aria-label="Previous page"
				>
					←
				</Button>
				<span className="text-xs">
					{page + 1} / {Math.max(1, Math.ceil(differences.length / 100))}
				</span>
				<Button
					variant="secondary"
					disabled={(page + 1) * 100 >= differences.length}
					onClick={() => setPage(page + 1)}
					aria-label="Next page"
				>
					→
				</Button>
				<Button
					disabled={!selected.size || prepare.isPending}
					onClick={() =>
						prepare.mutate({
							repositoryId: props.repositoryId,
							pointId: props.pointId,
							paths: [...selected],
						})
					}
				>
					{t("protection.repair")} ({selected.size})
				</Button>
			</div>
			<ConfirmDialog
				open={plan !== null}
				onOpenChange={(open) => {
					if (!open) setPlan(null)
				}}
				title={t("protection.repairTitle")}
				description={t("protection.repairDescription")}
				confirmLabel={t("protection.repair")}
				isPending={repair.isPending}
				onConfirm={() => {
					if (plan)
						repair.mutate({ repositoryId: props.repositoryId, planId: plan.id })
				}}
				body={
					<p className="text-xs">
						{plan?.files.length ?? 0} {t("protection.differences")}
					</p>
				}
			/>
		</section>
	)
}
