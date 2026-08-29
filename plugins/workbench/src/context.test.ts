import { describe, expect, it } from "vitest"
import {
	describeContext,
	describeHookDiagnostics,
	type HookSnapshot,
	type ResourceContext,
} from "./context.ts"

function makeCtx(
	snapshot: HookSnapshot | null,
	capabilities: { preview?: boolean; frame?: boolean } = {},
): ResourceContext {
	return {
		resId: "res-1",
		snapshot,
		state: null,
		capabilities: {
			preview: capabilities.preview ?? true,
			frame: capabilities.frame ?? true,
		},
	}
}

function makeSnapshot(overrides: Partial<HookSnapshot> = {}): HookSnapshot {
	return {
		detect: { ok: true },
		sourceMeta: undefined,
		searchMeta: undefined,
		files: undefined,
		fileStats: {},
		errors: {},
		...overrides,
	}
}

describe("describeHookDiagnostics", () => {
	it("is empty when there is no snapshot", () => {
		expect(describeHookDiagnostics(makeCtx(null))).toEqual([])
	})

	it("reports a detect verdict first (ok)", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ detect: { ok: true } })),
		)
		expect(rows).toEqual([{ kind: "detect", ok: true }])
	})

	it("reports a detect miss with its reasons", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ detect: { ok: false, reasons: ["page-image"] } })),
		)
		expect(rows[0]).toEqual({
			kind: "detect",
			ok: false,
			reasons: ["page-image"],
		})
	})

	it("counts files from the plugin's listFiles rows", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ files: [1, 2, 3] })),
		)
		expect(rows).toContainEqual({ kind: "files", count: 3 })
	})

	it("falls back to the measured fileStat count without listFiles", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ fileStats: { count: 5, sizeBytes: 100 } })),
		)
		expect(rows).toContainEqual({ kind: "files", count: 5 })
	})

	it("omits the files row when neither source is known", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ fileStats: {} })),
		)
		expect(rows).not.toContainEqual(expect.objectContaining({ kind: "files" }))
	})

	it("surfaces the chosen cover file", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ coverLocal: "010-wide.png" })),
		)
		expect(rows).toContainEqual({ kind: "cover", file: "010-wide.png" })
	})

	it("reports the image-hash count", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ imageHashes: [1, 2] })),
		)
		expect(rows).toContainEqual({ kind: "hashes", count: 2 })
	})

	it("reports a meta hook only when a value was captured", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ sourceMeta: { title: "x" } })),
		)
		expect(rows).toContainEqual({ kind: "meta", hook: "sourceMeta" })
		expect(rows).not.toContainEqual({ kind: "meta", hook: "searchMeta" })
	})

	it("emits one error row per failed hook with the message", () => {
		const rows = describeHookDiagnostics(
			makeCtx(makeSnapshot({ errors: { detect: "boom", listFiles: "nope" } })),
		)
		expect(rows).toContainEqual({
			kind: "error",
			hook: "detect",
			message: "boom",
		})
		expect(rows).toContainEqual({
			kind: "error",
			hook: "listFiles",
			message: "nope",
		})
	})

	it("places the detect verdict first and the failures last", () => {
		const rows = describeHookDiagnostics(
			makeCtx(
				makeSnapshot({
					detect: { ok: false, reasons: ["no-face"] },
					coverLocal: "c.png",
					errors: { coverLocal: "err" },
				}),
			),
		)
		expect(rows[0]).toEqual({ kind: "detect", ok: false, reasons: ["no-face"] })
		expect(rows[rows.length - 1]).toEqual({
			kind: "error",
			hook: "coverLocal",
			message: "err",
		})
	})

	it("never repeats render capabilities (they live in the Capabilities section)", () => {
		const without = describeHookDiagnostics(
			makeCtx(makeSnapshot(), { preview: true, frame: true }),
		)
		const withDisabled = describeHookDiagnostics(
			makeCtx(makeSnapshot(), { preview: false, frame: false }),
		)
		expect(withDisabled).toEqual(without)
	})
})

describe("describeContext", () => {
	it("is a single placeholder without a snapshot", () => {
		expect(describeContext(makeCtx(null))).toBe("no hook snapshot")
	})

	it("joins the diagnostic rows into one status line", () => {
		expect(describeContext(makeCtx(makeSnapshot({ files: [1, 2] })))).toBe(
			"detect ok · 2 files",
		)
	})

	it("includes the failure message for a failed hook", () => {
		const ctx = makeCtx(makeSnapshot({ errors: { coverLocal: "boom" } }))
		expect(describeContext(ctx)).toContain("coverLocal failed: boom")
	})
})
