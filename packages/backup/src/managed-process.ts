import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { isMissing } from "./files.ts"

const ownerToken = randomUUID()
const leaseSchema = z.object({
	ownerToken: z.string(),
	parentPid: z.number().int().positive(),
	wrapperPid: z.number().int().positive().nullable(),
	nativePid: z.number().int().positive().nullable(),
})

// The wrapper survives a parent crash long enough to stop the native child and close its files.
const WRAPPER = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const file = process.argv[1];
const lease = JSON.parse(fs.readFileSync(file, "utf8"));
let child;
let finished = false;
let killTimer;
function save() {
  const temporary = file + ".wrapper.tmp";
  fs.writeFileSync(temporary, JSON.stringify(lease), { mode: 0o600, flush: true });
  fs.renameSync(temporary, file);
}
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(killTimer);
  clearTimeout(startTimer);
  try { fs.unlinkSync(file); } catch {}
  process.exitCode = Number.isInteger(code) && code >= 0 ? code : 130;
  if (process.connected) process.disconnect();
}
function stop() {
  if (finished) return;
  if (!child) { finish(130); return; }
  child.kill("SIGTERM");
  killTimer ??= setTimeout(() => child.kill("SIGKILL"), 3000);
}
const startTimer = setTimeout(() => { if (!child) finish(1); }, 15000);
lease.wrapperPid = process.pid;
save();
process.on("disconnect", stop);
process.stdout.on("error", stop);
process.stderr.on("error", stop);
process.on("message", (message) => {
  if (message.kind === "cancel") { stop(); return; }
  if (message.kind !== "run" || child || finished) return;
  if (!process.connected) { finish(130); return; }
  clearTimeout(startTimer);
  child = spawn(message.binary, message.args, { cwd: message.cwd, env: message.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  lease.nativePid = child.pid ?? null;
  save();
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on("error", () => {});
  child.on("close", finish);
});
if (!process.connected) stop();
`

export function spawnManagedProcess(options: {
	binary: string
	args: readonly string[]
	cwd?: string
	env: NodeJS.ProcessEnv
	directory: string
}) {
	mkdirSync(options.directory, { recursive: true })
	const path = join(options.directory, `${randomUUID()}.json`)
	const temporary = `${path}.tmp`
	writeFileSync(
		temporary,
		JSON.stringify({
			ownerToken,
			parentPid: process.pid,
			wrapperPid: null,
			nativePid: null,
		}),
		{ mode: 0o600, flush: true },
	)
	renameSync(temporary, path)
	const child = spawn(process.execPath, ["-e", WRAPPER, path], {
		windowsHide: true,
		shell: false,
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	})
	child.once("spawn", () => {
		child.send(
			{
				kind: "run",
				binary: options.binary,
				args: options.args,
				cwd: options.cwd,
				env: options.env,
			},
			() => {},
		)
	})
	child.once("error", () => {
		if (!child.pid) rmSync(path, { force: true })
	})
	return child
}

function alive(pid: number | null): boolean {
	if (pid === null) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		return !(
			error instanceof Error &&
			"code" in error &&
			error.code === "ESRCH"
		)
	}
}

/** Unknown or live foreign leases keep a restarted service from racing old native writes. */
export async function inspectManagedProcesses(
	directory: string,
): Promise<{ active: number; uncertain: number }> {
	let files: string[]
	try {
		files = await readdir(directory)
	} catch (error) {
		if (isMissing(error)) return { active: 0, uncertain: 0 }
		throw error
	}
	let active = 0
	let uncertain = 0
	for (const name of files) {
		if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue
		const path = join(directory, name)
		let lease: z.infer<typeof leaseSchema>
		try {
			lease = leaseSchema.parse(JSON.parse(await readFile(path, "utf8")))
		} catch (error) {
			if (!isMissing(error)) uncertain++
			continue
		}
		if (lease.ownerToken === ownerToken) continue
		if (alive(lease.wrapperPid) || alive(lease.nativePid)) {
			active++
			continue
		}
		if (lease.wrapperPid === null && lease.nativePid === null) {
			uncertain++
			continue
		}
		await rm(path, { force: true })
	}
	return { active, uncertain }
}
