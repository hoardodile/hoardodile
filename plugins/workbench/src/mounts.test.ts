import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MOBILE_INITIAL_SCALE } from "@hoardodile/ui/viewport"
import { describe, expect, it } from "vitest"
import {
	createDirectoryProviders,
	createRebuildBus,
	createResourceDirProviders,
	createWorkbenchMounts,
	wrapPluginHtml,
} from "../scripts/mounts.mjs"

/**
 * Guards the fidelity promise of the `/plugin` mount: the page shell the
 * workbench serves is the shell the host server serves, including the
 * single viewport-scale constant from `@hoardodile/ui/viewport` —
 * the workbench can never drift from the app's mobile preview scale.
 */

const BRIDGE_MARK = "context-ready"

describe("wrapPluginHtml", () => {
	it("injects the app's mobile initial scale verbatim", () => {
		const html = wrapPluginHtml('<div id="root"></div>')
		expect(html).toContain(
			`initial-scale=${MOBILE_INITIAL_SCALE}, maximum-scale=1.0, user-scalable=0`,
		)
	})

	it("keeps the overflow reset and the postMessage bridge", () => {
		const html = wrapPluginHtml('<div id="root"></div>')
		expect(html).toContain(
			"html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}",
		)
		expect(html).toContain(`new CustomEvent("${BRIDGE_MARK}"`)
	})

	it("embeds the plugin body untouched between shell body tags", () => {
		const html = wrapPluginHtml(
			'<script>window.marker=1</script><div id="root"></div>',
		)
		expect(html).toContain(
			'<script>window.marker=1</script><div id="root"></div>',
		)
	})

	it("closes the shell after the body", () => {
		const html = wrapPluginHtml("<div></div>")
		expect(html.endsWith("</body></html>")).toBe(true)
	})
})

/** Build a temp folder-of-resources tree and return its root (cleanup in `finally`). */
function makeResourceRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "wb-res-"))
	for (const name of ["alpha", "beta"]) {
		const dir = join(root, name)
		mkdirSync(dir)
		writeFileSync(join(dir, "entry.txt"), `${name}-entry`)
		writeFileSync(join(dir, "cover.png"), "png")
	}
	writeFileSync(join(root, "loose.txt"), "not a resource")
	return root
}

describe("createResourceDirProviders", () => {
	it("lists each direct subfolder as a resource named by its basename, ignoring loose root files", () => {
		const root = makeResourceRoot()
		try {
			const providers = createResourceDirProviders(root)
			expect(providers.resources()).toEqual([
				{ id: "alpha", name: "alpha" },
				{ id: "beta", name: "beta" },
			])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("scopes file listing to the selected resource's folder", () => {
		const root = makeResourceRoot()
		try {
			const providers = createResourceDirProviders(root)
			expect(providers.files.list("alpha")).toEqual(["cover.png", "entry.txt"])
			expect(providers.files.list("beta")).toEqual(["cover.png", "entry.txt"])
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("reads bytes only from the selected resource's folder", () => {
		const root = makeResourceRoot()
		try {
			const providers = createResourceDirProviders(root)
			const bytes = providers.files.read("alpha", "entry.txt")
			expect(Buffer.from(bytes ?? []).toString("utf-8")).toBe("alpha-entry")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("stats a file within the selected resource, undefined for another", () => {
		const root = makeResourceRoot()
		try {
			const providers = createResourceDirProviders(root)
			expect(providers.files.stat("alpha", "entry.txt")).toEqual({
				sizeBytes: "alpha-entry".length,
			})
			expect(providers.files.stat("beta", "entry.txt")).toEqual({
				sizeBytes: "beta-entry".length,
			})
			expect(providers.files.stat("alpha", "missing.txt")).toBeUndefined()
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("resolves a missing or escaping resource to empty/undefined, never outside the root", () => {
		const root = makeResourceRoot()
		try {
			const providers = createResourceDirProviders(root)
			expect(providers.resources().some((r) => r.id === "missing")).toBe(false)
			expect(providers.files.list("missing")).toEqual([])
			expect(providers.files.stat("missing", "entry.txt")).toBeUndefined()
			expect(providers.files.read("missing", "entry.txt")).toBeUndefined()
			// `..` never reads a file in the parent of the resource root.
			expect(providers.files.read("..", "entry.txt")).toBeUndefined()
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

describe("createDirectoryProviders (single resource)", () => {
	it("keeps the single-resource shape and reads from the directory root", () => {
		const root = mkdtempSync(join(tmpdir(), "wb-single-"))
		try {
			writeFileSync(join(root, "doc.txt"), "hello")
			const providers = createDirectoryProviders(root)
			expect(providers.resources()).toEqual([
				{ id: "workbench", name: "Workbench" },
			])
			expect(providers.files.list()).toEqual(["doc.txt"])
			expect(readFileSync(join(root, "doc.txt"), "utf8")).toBe("hello")
			expect(
				Buffer.from(
					providers.files.read("workbench", "doc.txt") ?? [],
				).toString(),
			).toBe("hello")
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})

// ── Rebuild stream (SSE) + no-store plugin bundle ────────────────────────

/** Minimal res double for the SSE bus/mount (writeHead/write/end/on). */
function fakeSseRes() {
	const headers: Record<string, string> = {}
	const listeners: Record<string, Array<() => void>> = {}
	return {
		statusCode: 200,
		headers,
		written: [] as string[],
		ended: false,
		writeHead(status: number, hdrs: Record<string, string>) {
			this.statusCode = status
			Object.assign(headers, hdrs)
		},
		setHeader(key: string, value: string) {
			headers[String(key).toLowerCase()] = value
		},
		write(data: string) {
			this.written.push(data)
			return true
		},
		end() {
			this.ended = true
		},
		on(_event: string, fn: () => void) {
			const list = listeners[_event] ?? []
			list.push(fn)
			listeners[_event] = list
		},
	}
}

/** Minimal res double for the plain JSON/bytes mounts. */
function fakeRes() {
	const headers: Record<string, string> = {}
	return {
		statusCode: 200,
		headers,
		body: "" as string,
		setHeader(key: string, value: string) {
			headers[String(key).toLowerCase()] = value
		},
		end(body: string | Uint8Array = "") {
			this.body = typeof body === "string" ? body : Buffer.from(body).toString()
		},
	}
}

async function driveMounts(
	mounts: Array<(req: unknown, res: unknown) => unknown>,
	path: string,
	res: unknown,
) {
	for (const mount of mounts) {
		if (await mount({ method: "GET", url: path }, res)) return true
	}
	return false
}

describe("createRebuildBus", () => {
	it("emits a connect frame and broadcasts rebuild frames to subscribers", () => {
		const bus = createRebuildBus()
		const res = fakeSseRes()
		const off = bus.subscribe(res)
		try {
			expect(res.written).toEqual(['data: {"kind":"ready"}\n\n'])
			bus.emit({ kind: "rebuild" })
			expect(res.written).toContain('data: {"kind":"rebuild"}\n\n')
			bus.emit({ kind: "rebuild" })
			expect(res.written.filter((w) => w.includes('"kind":"rebuild"'))).toEqual(
				['data: {"kind":"rebuild"}\n\n', 'data: {"kind":"rebuild"}\n\n'],
			)
		} finally {
			off()
		}
	})

	it("unsubscribe stops delivery", () => {
		const bus = createRebuildBus()
		const res = fakeSseRes()
		bus.subscribe(res)
		bus.emit({ kind: "rebuild" })
		// Re-subscribe a fresh subscriber to prove the first is gone.
		bus.close()
		const second = fakeSseRes()
		const off = bus.subscribe(second)
		try {
			bus.emit({ kind: "rebuild" })
			expect(second.written).toContain('data: {"kind":"rebuild"}\n\n')
		} finally {
			off()
		}
	})

	it("close ends every open stream and denies further delivery", () => {
		const bus = createRebuildBus()
		const a = fakeSseRes()
		const b = fakeSseRes()
		bus.subscribe(a)
		bus.subscribe(b)
		bus.close()
		expect(a.ended).toBe(true)
		expect(b.ended).toBe(true)
		// After close, emit must not resurrect them.
		bus.emit({ kind: "rebuild" })
		expect(a.written.filter((w) => w.includes('"kind":"rebuild"'))).toEqual([])
	})
})

describe("rebuild events mount", () => {
	it("serves an SSE stream over /api/workbench/events and forwards emits", async () => {
		const bus = createRebuildBus()
		const mounts = createWorkbenchMounts({
			providers: { resources: () => [] },
			rebuildBus: bus,
		})
		const res = fakeSseRes()
		const handled = await driveMounts(mounts, "/api/workbench/events", res)
		try {
			expect(handled).toBe(true)
			expect(res.statusCode).toBe(200)
			expect(res.headers["content-type"]).toContain("text/event-stream")
			expect(res.headers["cache-control"]).toContain("no-store")
			expect(res.written).toEqual(['data: {"kind":"ready"}\n\n'])
			bus.emit({ kind: "rebuild" })
			expect(res.written).toContain('data: {"kind":"rebuild"}\n\n')
		} finally {
			bus.close()
		}
	})

	it("does not swallow the other /api/workbench/* routes", async () => {
		const bus = createRebuildBus()
		const mounts = createWorkbenchMounts({
			providers: { resources: () => ["x"] },
			rebuildBus: bus,
		})
		try {
			const res = fakeRes()
			const handled = await driveMounts(mounts, "/api/workbench/resources", res)
			expect(handled).toBe(true)
			expect(res.body).toBe('["x"]')
		} finally {
			bus.close()
		}
	})
})

describe("static plugin mount", () => {
	it("serves the bundle with no-store so a reload always picks up a rebuild", async () => {
		const dir = mkdtempSync(join(tmpdir(), "wb-plugin-"))
		try {
			writeFileSync(join(dir, "index.html"), '<div id="root"></div>')
			writeFileSync(join(dir, "app.js"), "console.log(1)")
			const mounts = createWorkbenchMounts({
				pluginDir: dir,
				providers: { resources: () => [] },
			})

			const html = fakeRes()
			await driveMounts(mounts, "/plugin/index.html", html)
			expect(html.headers["cache-control"]).toBe(
				"no-cache, no-store, must-revalidate",
			)
			expect(html.body).toContain('<div id="root"></div>')

			const js = fakeRes()
			await driveMounts(mounts, "/plugin/app.js", js)
			expect(js.headers["cache-control"]).toBe(
				"no-cache, no-store, must-revalidate",
			)
			expect(Buffer.from(js.body).toString()).toBe("console.log(1)")
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("byte mounts serve no-store so a rebuild is never masked by the browser cache", () => {
	it("serves /data bytes with no-cache, no-store, must-revalidate", async () => {
		const root = mkdtempSync(join(tmpdir(), "wb-data-"))
		try {
			writeFileSync(join(root, "doc.txt"), "v1")
			const data = createDirectoryProviders(root)
			const mounts = createWorkbenchMounts({
				providers: { resources: () => [], files: data.files },
			})
			const res = fakeRes()
			const handled = await driveMounts(mounts, "/data/doc.txt", res)
			expect(handled).toBe(true)
			expect(res.headers["cache-control"]).toBe(
				"no-cache, no-store, must-revalidate",
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("serves an /api/resources file with the same no-store header", async () => {
		const root = mkdtempSync(join(tmpdir(), "wb-resfile-"))
		try {
			writeFileSync(join(root, "entry.txt"), "entry")
			const data = createDirectoryProviders(root)
			const mounts = createWorkbenchMounts({
				providers: { resources: () => [], files: data.files },
			})
			const res = fakeRes()
			const handled = await driveMounts(
				mounts,
				"/api/resources/workbench/files/tok/entry.txt",
				res,
			)
			expect(handled).toBe(true)
			expect(res.headers["cache-control"]).toBe(
				"no-cache, no-store, must-revalidate",
			)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
