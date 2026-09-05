import { createRequire } from "node:module"
import { Worker } from "node:worker_threads"
import { z } from "zod"

const resultSchema = z.object({ schema: z.string(), createdAt: z.number() })

/** Keep SQLite snapshot creation and integrity checks off the HTTP event loop. */
export function createDatabaseCheckpoint(options: {
	source: string
	destination: string
	signal?: AbortSignal
}): Promise<z.infer<typeof resultSchema>> {
	options.signal?.throwIfAborted()
	return new Promise((resolve, reject) => {
		const worker = new Worker(
			`
const { parentPort, workerData } = require("node:worker_threads");
const Database = require(workerData.modulePath);
let source;
let destination;
(async () => {
  try {
    source = new Database(workerData.source, { readonly: true, fileMustExist: true });
    await source.backup(workerData.destination);
    const createdAt = Date.now();
    source.close(); source = undefined;
    destination = new Database(workerData.destination, { fileMustExist: true });
    destination.pragma("journal_mode = DELETE");
    for (const table of ["auth", "auth_sign_ins", "sync_devices", "sync_records"]) {
      if (destination.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        destination.exec('DELETE FROM "' + table + '"');
      }
    }
    const integrity = destination.pragma("integrity_check");
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("SQLite integrity check failed");
    if (destination.pragma("foreign_key_check").length) throw new Error("SQLite foreign key check failed");
    const schema = JSON.stringify(destination.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name").all());
    destination.close(); destination = undefined;
    parentPort.postMessage({ schema, createdAt });
  } finally {
    if (source) source.close();
    if (destination) destination.close();
  }
})().catch((error) => { throw error; });
`,
			{
				eval: true,
				workerData: {
					modulePath: createRequire(import.meta.url).resolve("better-sqlite3"),
					source: options.source,
					destination: options.destination,
				},
			},
		)
		let result: z.infer<typeof resultSchema> | undefined
		let failure: Error | undefined
		const abort = () => {
			failure = new Error("Checkpoint creation cancelled")
			void worker.terminate()
		}
		options.signal?.addEventListener("abort", abort, { once: true })
		worker.on("message", (message: unknown) => {
			const parsed = resultSchema.safeParse(message)
			if (parsed.success) result = parsed.data
			else failure = new Error("Invalid checkpoint worker result")
		})
		worker.on("error", (error: unknown) => {
			failure =
				error instanceof Error ? error : new Error("Checkpoint worker failed")
		})
		worker.on("exit", (code) => {
			options.signal?.removeEventListener("abort", abort)
			if (failure) reject(failure)
			else if (code !== 0 || !result)
				reject(new Error("Checkpoint creation failed"))
			else resolve(result)
		})
	})
}
