/**
 * A generic pass-manager primitive: run a list of labelled stages over
 * one shared context, with per-stage error isolation. The compiler
 * pipeline shape the resource flows are built on — each stage
 * transforms (mutates) the same context, the runner owns the failure
 * policy, and a stage's crash never aborts its siblings.
 */
export type Stage<Ctx> = {
	readonly label: string
	readonly run: (ctx: Ctx) => Promise<void>
}

export type StageFailure = {
	readonly label: string
	readonly error: unknown
}

export type StageReport = {
	readonly failures: readonly StageFailure[]
}

export type RunStagesOptions = {
	/**
	 * Run the stages concurrently over the shared context. Defaults to
	 * `false` (strict order). Stages must tolerate concurrent mutation
	 * of disjoint context fields when enabled.
	 */
	readonly parallel?: boolean
	/**
	 * Fail fast: rethrow the first stage failure and skip the remaining
	 * stages. Implies sequential execution (a parallel group cannot be
	 * aborted cleanly). Defaults to `false` — stages are isolated and
	 * the run completes with the failures reported.
	 */
	readonly failFast?: boolean
	/**
	 * Called for every failed stage (after the failure is recorded).
	 * Defaults to no-op; the report carries the failures either way.
	 */
	readonly onStageError?: (label: string, error: unknown) => void
}

/**
 * Run `stages` over `ctx`. By default a failing stage is recorded in
 * the returned report (and reported via `onStageError`) while the
 * remaining stages still run — callers decide whether a partial run is
 * acceptable. With `failFast`, the first failure aborts the run.
 */
export async function runStages<Ctx>(
	stages: readonly Stage<Ctx>[],
	ctx: Ctx,
	opts?: RunStagesOptions,
): Promise<StageReport> {
	const failFast = opts?.failFast === true
	const failures: StageFailure[] = []
	async function runOne(stage: Stage<Ctx>): Promise<void> {
		try {
			await stage.run(ctx)
		} catch (error) {
			failures.push({ label: stage.label, error })
			opts?.onStageError?.(stage.label, error)
			if (failFast) throw error
		}
	}
	if (opts?.parallel === true && !failFast) {
		await Promise.all(stages.map(runOne))
	} else {
		for (const stage of stages) await runOne(stage)
	}
	return { failures }
}
