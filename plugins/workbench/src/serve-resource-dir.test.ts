import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { serveWorkbench } from "../scripts/serve.mjs"

/**
 * Exercises the `--resource-dir` mount over HTTP: a folder of resources
 * lists its subfolders, `/data` reads are scoped per resource, and a
 * `--data` (single resource) root still behaves as one resource. Only the
 * read-only mounts are hit, so no built SPA is needed.
 */

const servers: Server[] = []

function track(server: Server): Server {
	servers.push(server)
	return server
}

afterEach(async () => {
	await Promise.all(
		servers.map(
			(server) =>
				new Promise<void>((resolveClose) => server.close(() => resolveClose())),
		),
	)
	servers.length = 0
})

function boundPort(server: Server): number {
	const address = server.address()
	if (address === null || typeof address === "string") {
		throw new Error("server has no bound port")
	}
	return address.port
}

async function startWorkbench(
	opts: Parameters<typeof serveWorkbench>[0],
): Promise<string> {
	const server = track(
		await serveWorkbench({ host: "127.0.0.1", port: 0, ...opts }),
	)
	return `http://127.0.0.1:${boundPort(server)}`
}

async function json<T>(url: string): Promise<T> {
	const res = await fetch(url)
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
	return res.json() as Promise<T>
}

let resourceRoot: string
let dataRoot: string

beforeAll(() => {
	resourceRoot = mkdtempSync(join(tmpdir(), "wb-http-res-"))
	for (const name of ["alpha", "beta"]) {
		mkdirSync(join(resourceRoot, name))
		writeFileSync(join(resourceRoot, name, "entry.txt"), `${name}-entry`)
	}
	writeFileSync(join(resourceRoot, "loose.txt"), "loose")

	dataRoot = mkdtempSync(join(tmpdir(), "wb-http-data-"))
	writeFileSync(join(dataRoot, "doc.txt"), "hello")
})

afterAll(() => {
	rmSync(resourceRoot, { recursive: true, force: true })
	rmSync(dataRoot, { recursive: true, force: true })
})

describe("serveWorkbench with --resource-dir", () => {
	it("lists each direct subfolder as a resource", async () => {
		const base = await startWorkbench({ resourceDir: resourceRoot })
		const resources = await json<
			ReadonlyArray<{ readonly id: string; readonly name: string }>
		>(`${base}/api/workbench/resources`)
		expect(resources).toEqual([
			{ id: "alpha", name: "alpha" },
			{ id: "beta", name: "beta" },
		])
	})

	it("lists a resource's files scoped to its own subfolder", async () => {
		const base = await startWorkbench({ resourceDir: resourceRoot })
		expect(await json<string[]>(`${base}/data/?list=1&res=alpha`)).toEqual([
			"entry.txt",
		])
		expect(await json<string[]>(`${base}/data/?list=1&res=beta`)).toEqual([
			"entry.txt",
		])
	})

	it("reads a resource's bytes scoped to its own subfolder", async () => {
		const base = await startWorkbench({ resourceDir: resourceRoot })
		const bytes = await (await fetch(`${base}/data/entry.txt?res=beta`)).text()
		expect(bytes).toBe("beta-entry")
	})

	it("reports no snapshot/state/capabilities when the pipeline is not wired", async () => {
		const base = await startWorkbench({ resourceDir: resourceRoot })
		const ctx = await json<{
			readonly snapshot: unknown
			readonly state: unknown
			readonly capabilities: Record<string, boolean>
		}>(`${base}/api/workbench/context?res=alpha`)
		expect(ctx.snapshot).toBeNull()
		expect(ctx.state).toBeNull()
		expect(ctx.capabilities).toEqual({
			preview: false,
			frame: false,
			cover: false,
		})
	})

	it("never reads a file outside the resource root for a traversal id", async () => {
		const base = await startWorkbench({ resourceDir: resourceRoot })
		const res = await fetch(`${base}/data/entry.txt?res=..`)
		expect(res.status).toBe(404)
	})
})

describe("serveWorkbench with --data (single resource) is unchanged", () => {
	it("exposes exactly one resource named Workbench and reads from the data root", async () => {
		const base = await startWorkbench({ dataDir: dataRoot })
		const resources = await json<
			ReadonlyArray<{ readonly id: string; readonly name: string }>
		>(`${base}/api/workbench/resources`)
		expect(resources).toEqual([{ id: "workbench", name: "Workbench" }])
		expect(await json<string[]>(`${base}/data/?list=1`)).toEqual(["doc.txt"])
	})
})
