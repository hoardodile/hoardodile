import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runPluginHook } from "./dev-runner.ts"

const FIXTURE_PLUGIN = `
export default {
	async detect(api) {
		const files = await api.listFileNames()
		return files.some((f) => f.endsWith(".hdtpl"))
			? { ok: true }
			: { ok: false, reasons: ["no .hdtpl file"] }
	},
}
`

describe("runPluginHook", () => {
	let rootDir: string
	let dir: string
	let mainPath: string

	beforeEach(() => {
		rootDir = mkdtempSync(join(tmpdir(), "dev-runner-test-"))
		dir = join(rootDir, "resource")
		mkdirSync(dir)
		writeFileSync(join(dir, "chapter.hdtpl"), "tpl")
		mainPath = join(rootDir, "main.js")
		writeFileSync(mainPath, FIXTURE_PLUGIN)
	})

	afterEach(() => {
		rmSync(rootDir, { recursive: true, force: true })
	})

	test("runs the hook with a directory-backed ResourceAPI", async () => {
		const { result, durationMs } = await runPluginHook({
			mainPath,
			hook: "detect",
			dir,
		})
		expect(result).toEqual({ ok: true })
		expect(durationMs).toBeGreaterThanOrEqual(0)
	})

	test("throws a clear error when the hook is missing", async () => {
		await expect(
			runPluginHook({ mainPath, hook: "sourceMeta", dir }),
		).rejects.toThrow(/no "sourceMeta" hook/)
	})

	test("throws when the module has no default-export definition", async () => {
		writeFileSync(mainPath, "export const x = 1\n")
		await expect(
			runPluginHook({ mainPath, hook: "detect", dir }),
		).rejects.toThrow(/default-export a plugin definition/)
	})

	test("runs detect first so later hooks see the payload via api.context", async () => {
		writeFileSync(
			mainPath,
			`export default {
				async detect() {
					return { ok: true, shape: { hasChapter: true } }
				},
				async sourceMeta(api) {
					return { context: api.context.detect }
				},
			}`,
		)
		const { result } = await runPluginHook({
			mainPath,
			hook: "sourceMeta",
			dir,
		})
		expect(result).toEqual({ context: { shape: { hasChapter: true } } })
	})

	test("a failed detection leaves the context absent", async () => {
		writeFileSync(
			mainPath,
			`export default {
				async detect() {
					return { ok: false, reasons: ["no match"] }
				},
				async sourceMeta(api) {
					return { context: api.context.detect }
				},
			}`,
		)
		const { result } = await runPluginHook({
			mainPath,
			hook: "sourceMeta",
			dir,
		})
		expect(result).toEqual({ context: undefined })
	})
})
