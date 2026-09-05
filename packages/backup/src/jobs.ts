import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { atomicWrite, isMissing } from "./files.ts"
import { BackupError } from "./types.ts"

export const jobRecord = z.object({
	id: z.uuid(),
	kind: z.string().min(1),
	input: z.unknown(),
	state: z.enum([
		"queued",
		"running",
		"cancelling",
		"succeeded",
		"failed",
		"cancelled",
		"interrupted",
	]),
	createdAt: z.number(),
	updatedAt: z.number(),
	progress: z.unknown().optional(),
	result: z.unknown().optional(),
	error: z.object({ code: z.string(), message: z.string() }).optional(),
})
export type JobRecord = z.infer<typeof jobRecord>
export type JobContext = {
	signal: AbortSignal
	progress: (value: unknown) => void
	jobId: string
}
export type JobHandler = (
	input: unknown,
	context: JobContext,
) => Promise<unknown>

/** Jobs survive restarts; an interrupted handler is retried explicitly with its saved input. */
export async function createJobManager(options: {
	directory: string
	handlers: Record<string, JobHandler>
	onChange?: (job: JobRecord) => void
	onError?: (error: unknown) => void
}) {
	await mkdir(options.directory, { recursive: true })
	const jobs = new Map<string, JobRecord>()
	const active = new Map<
		string,
		{ controller: AbortController; done: Promise<void> }
	>()
	const writes = new Map<string, Promise<void>>()
	let closed = false
	const persist = (job: JobRecord) => {
		const previous = writes.get(job.id) ?? Promise.resolve()
		const content = JSON.stringify(job)
		const next = previous.then(() =>
			atomicWrite(join(options.directory, `${job.id}.json`), content),
		)
		writes.set(job.id, next)
		return next
	}
	for (const name of await readdir(options.directory)) {
		if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
		let job: JobRecord
		try {
			job = jobRecord.parse(
				JSON.parse(await readFile(join(options.directory, name), "utf8")),
			)
		} catch {
			const id = z.uuid().safeParse(name.slice(0, -5))
			if (id.success)
				jobs.set(id.data, {
					id: id.data,
					kind: "damaged-record",
					input: null,
					state: "failed",
					createdAt: 0,
					updatedAt: Date.now(),
					error: {
						code: "invalid_job_record",
						message:
							"This operation record is damaged; its original file has been preserved",
					},
				})
			continue
		}
		if (["running", "queued", "cancelling"].includes(job.state)) {
			job.state = "interrupted"
			job.updatedAt = Date.now()
			await persist(job)
		}
		jobs.set(job.id, job)
	}
	const changed = (job: JobRecord) => {
		job.updatedAt = Date.now()
		options.onChange?.(structuredClone(job))
	}
	async function execute(job: JobRecord, controller: AbortController) {
		try {
			job.state = "running"
			changed(job)
			await persist(job)
			const handler = options.handlers[job.kind]
			if (!handler)
				throw new BackupError("unknown_job", "The job is unsupported")
			let lastProgress = 0
			const result = await handler(job.input, {
				signal: controller.signal,
				jobId: job.id,
				progress: (value) => {
					job.progress =
						value &&
						typeof value === "object" &&
						!Array.isArray(value) &&
						job.progress &&
						typeof job.progress === "object" &&
						!Array.isArray(job.progress)
							? { ...job.progress, ...value }
							: value
					if (Date.now() - lastProgress > 250) {
						lastProgress = Date.now()
						changed(job)
					}
				},
			})
			job.result = result
			job.state = "succeeded"
		} catch (error) {
			options.onError?.(error)
			job.state =
				controller.signal.aborted ||
				(error instanceof BackupError && error.code === "cancelled")
					? "cancelled"
					: "failed"
			job.error =
				error instanceof BackupError
					? { code: error.code, message: error.message }
					: {
							code: "operation_failed",
							message:
								"The operation failed; check the repository and available disk space",
						}
		} finally {
			changed(job)
			try {
				await persist(job)
			} finally {
				active.delete(job.id)
			}
		}
	}
	async function start(kind: string, input: unknown): Promise<JobRecord> {
		if (closed)
			throw new BackupError("shutting_down", "The service is shutting down")
		if (!options.handlers[kind])
			throw new BackupError("unknown_job", "The job is unsupported")
		const job: JobRecord = {
			id: randomUUID(),
			kind,
			input,
			state: "queued",
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}
		await persist(job)
		jobs.set(job.id, job)
		const controller = new AbortController()
		const done = Promise.resolve().then(() => execute(job, controller))
		active.set(job.id, { controller, done })
		// Completion remains observable through status even if persistence fails.
		void done.catch(() => {})
		return structuredClone(job)
	}
	return {
		start,
		list: () =>
			[...jobs.values()]
				.sort((a, b) => b.createdAt - a.createdAt)
				.slice(0, 100)
				.map((job) => structuredClone({ ...job, result: undefined })),
		get: (id: string) => {
			const job = jobs.get(id)
			return job ? structuredClone(job) : undefined
		},
		async cancel(id: string) {
			const running = active.get(id)
			const job = jobs.get(id)
			if (!running || !job) return
			job.state = "cancelling"
			changed(job)
			await persist(job)
			running.controller.abort()
			await running.done
		},
		async retry(id: string) {
			const job = jobs.get(id)
			if (!job || active.has(id) || job.state === "succeeded")
				throw new BackupError("invalid_retry", "The job cannot be retried")
			return start(job.kind, job.input)
		},
		async close() {
			closed = true
			for (const entry of active.values()) entry.controller.abort()
			await Promise.allSettled([...active.values()].map((entry) => entry.done))
			await Promise.all([...writes.values()])
		},
	}
}

export type JobManager = Awaited<ReturnType<typeof createJobManager>>

export async function readJsonState<T>(
	path: string,
	schema: z.ZodType<T>,
	fallback: () => T,
): Promise<T> {
	try {
		return schema.parse(JSON.parse(await readFile(path, "utf8")))
	} catch (error) {
		if (isMissing(error)) return fallback()
		throw error
	}
}
