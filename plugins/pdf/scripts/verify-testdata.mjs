/**
 * Structural verification for testdata/: every PDF must be openable and
 * expose a non-empty text layer where multi-page content is expected.
 *
 * This is the regression check for the "second page never renders" bug —
 * a hand-built fixture whose object ids collided produced PDFs that
 * pdf.js opened but could not actually render past page one.
 *
 * Runs pdfjs-dist's legacy build inside Node (no canvas needed for
 * parsing and text extraction).
 */
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
	GlobalWorkerOptions,
	getDocument,
} from "pdfjs-dist/legacy/build/pdf.mjs"

// Bare-specifier URL resolved against this project's node_modules.
GlobalWorkerOptions.workerSrc = import.meta.resolve(
	"pdfjs-dist/legacy/build/pdf.worker.min.mjs",
)

const here = dirname(fileURLToPath(import.meta.url))
const testdataDir = join(here, "..", "testdata")

/** Per-file expectations; `skipText` marks the negative fixture. */
const EXPECTATIONS = {
	"tracemonkey.pdf": { minPages: 2, pageTwoText: true },
	"basicapi.pdf": { minPages: 2, pageTwoText: true },
	// CJK specimen: decoding its font needs cMaps, which the plugin does
	// not bundle (see the plugin README) — the check here is openability.
	"XiaoBiaoSong.pdf": { minPages: 1 },
	"two-pages.pdf": { minPages: 2, pageTwoText: true },
	"three-pages.pdf": { minPages: 3, pageTwoText: true },
	"fake.pdf": { skip: true },
}

function pageText(items) {
	return items
		.map((item) => ("str" in item ? item.str : ""))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
}

let failures = 0

for (const name of (await readdir(testdataDir)).sort()) {
	if (!name.endsWith(".pdf")) continue
	const expected = EXPECTATIONS[name]
	if (expected === undefined) {
		console.warn(
			`[verify-testdata] unknown sample "${name}" — add an expectation`,
		)
		failures++
		continue
	}
	if (expected.skip) {
		console.log(`[ok] ${name} — negative fixture, skipped`)
		continue
	}

	const data = new Uint8Array(await readFile(join(testdataDir, name)))
	const loadingTask = getDocument({ data, disableFontFace: true })
	let doc
	try {
		doc = await loadingTask.promise
	} catch (err) {
		console.error(`[fail] ${name} — could not open: ${String(err)}`)
		failures++
		continue
	}
	try {
		if (doc.numPages < expected.minPages) {
			console.error(
				`[fail] ${name} — expected ≥ ${expected.minPages} pages, got ${doc.numPages}`,
			)
			failures++
			continue
		}
		const first = pageText(
			(await (await doc.getPage(1)).getTextContent()).items,
		)
		if (expected.someText && first.length === 0) {
			console.error(`[fail] ${name} — page 1 has no text`)
			failures++
			continue
		}
		let second = ""
		if (expected.pageTwoText) {
			second = pageText((await (await doc.getPage(2)).getTextContent()).items)
			if (second.length === 0) {
				console.error(
					`[fail] ${name} — page 2 opened but has no text (render would hang/blank)`,
				)
				failures++
				continue
			}
		}
		console.log(
			`[ok] ${name} — ${doc.numPages} pages, page-2 text ${second.length} chars`,
		)
	} finally {
		await loadingTask.destroy()
	}
}

if (failures > 0) {
	console.error(`[verify-testdata] ${failures} sample(s) failed`)
	process.exit(1)
}
console.log("[verify-testdata] all samples verified")
