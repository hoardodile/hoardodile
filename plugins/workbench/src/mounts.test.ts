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
	createResourceDirProviders,
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
