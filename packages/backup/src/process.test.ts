import { spawn } from "node:child_process"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import { afterEach, expect, it } from "vitest"
import { inspectManagedProcesses } from "./managed-process.ts"
import { runBinary } from "./process.ts"

const roots: string[] = []
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

it("ignores human progress without losing structured records", async () => {
	const records: unknown[] = []
	await runBinary({
		binary: process.execPath,
		args: [
			"-e",
			'console.log("copy started");console.log("[0:00] 100%");console.log(JSON.stringify({message_type:"summary",ok:true}))',
		],
		onJson: (value) => records.push(value),
	})
	expect(records).toEqual([{ message_type: "summary", ok: true }])
})

it("waits for a cancelled native child to exit before releasing its lease", async () => {
	const root = await mkdtemp(join(tmpdir(), "hd-process-cancel-"))
	roots.push(root)
	const controller = new AbortController()
	const operation = runBinary({
		binary: process.execPath,
		args: [
			"-e",
			"console.log(JSON.stringify({ready:true}));setInterval(()=>{},1000)",
		],
		leaseDirectory: root,
		signal: controller.signal,
		onJson: () => controller.abort(),
	})
	await expect(operation).rejects.toMatchObject({ code: "cancelled" })
	expect(
		(await readdir(root)).filter((name) => name.endsWith(".json")),
	).toHaveLength(0)
}, 15_000)

it("stops the native process after its parent dies and makes the foreign lease recoverable", async () => {
	const root = await mkdtemp(join(tmpdir(), "hd-process-crash-"))
	roots.push(root)
	const moduleUrl = pathToFileURL(join(import.meta.dirname, "process.ts")).href
	const native =
		'console.log(JSON.stringify({ready:true}));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'
	const code = `import {runBinary} from ${JSON.stringify(moduleUrl)};await runBinary({binary:process.execPath,args:["-e",${JSON.stringify(native)}],leaseDirectory:${JSON.stringify(root)},onJson:()=>console.log("ready")});`
	const parent = spawn(
		process.execPath,
		["--experimental-transform-types", "--input-type=module", "-e", code],
		{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
	)
	const closed = new Promise<void>((resolve) =>
		parent.once("close", () => resolve()),
	)
	parent.stderr.resume()
	try {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("The test parent did not start")),
				10_000,
			)
			parent.stdout.once("data", () => {
				clearTimeout(timeout)
				resolve()
			})
			parent.once("error", reject)
		})
		expect((await inspectManagedProcesses(root)).active).toBe(1)
		parent.kill("SIGKILL")
		await closed
		const deadline = Date.now() + 10_000
		let state = await inspectManagedProcesses(root)
		while (state.active + state.uncertain > 0 && Date.now() < deadline) {
			await delay(100)
			state = await inspectManagedProcesses(root)
		}
		expect(state).toEqual({ active: 0, uncertain: 0 })
	} finally {
		parent.kill("SIGKILL")
		await closed
	}
}, 25_000)
