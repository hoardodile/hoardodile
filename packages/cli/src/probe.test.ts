import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { describe, expect, test } from "vitest"
import { buildCliResourceAPI } from "./runner.ts"

/**
 * Regression guard for the CLI's image-probe path: `buildCliResourceAPI`
 * wires `mediaProbes` (whose image probe needs `sharp`), so an image
 * `api.probe` must return real dimensions. The CLI declares `sharp` as a
 * runtime dependency — if that is ever dropped, `loadSharp()` fails and
 * `api.probe` degrades to `{ kind: "unknown", reason: "failed" }`, which
 * this test catches. `hoardodile plugin dev`/`run` use this same API, so a
 * workbench res card would lose its `source.width`/`source.height` badge.
 */
describe("buildCliResourceAPI image probe (needs sharp from cli deps)", () => {
	test("probes a real PNG and returns its dimensions", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cli-probe-img-"))
		try {
			// A real PNG on disk: probe must sniff then decode it via sharp.
			const png = await sharp({
				create: {
					width: 32,
					height: 24,
					channels: 3,
					background: { r: 1, g: 2, b: 3 },
				},
			})
				.png()
				.toBuffer()
			writeFileSync(join(dir, "tex.png"), png)

			const api = buildCliResourceAPI(dir)
			const probed = await api.probe("tex.png")

			expect(probed.kind).toBe("image")
			if (probed.kind === "image") {
				expect(probed.width).toBe(32)
				expect(probed.height).toBe(24)
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
