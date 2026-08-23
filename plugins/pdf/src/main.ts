import { definePlugin } from "@hoardodile/sdk-server"
import { extname } from "@hoardodile/sdk-server/helpers"
import { countPagesFromBytes, pdfVersionFromBytes } from "./page-count"
import type { PdfSchema } from "./shared"

/**
 * Full reads only for small files — the cheap page-count scan needs the
 * uncompressed object text, and reading a 200 MB scan into memory per
 * rescan is not acceptable. Bigger resources report page count lazily in
 * the viewer instead.
 */
const PAGE_COUNT_READ_MAX_BYTES = 8 * 1024 * 1024

function isPdfName(name: string): boolean {
	return extname(name).toLowerCase() === ".pdf"
}

export default definePlugin<PdfSchema>({
	detect: async (api) => {
		const pdfs = (await api.listFileNames()).filter(isPdfName)
		if (pdfs.length === 0) {
			return { ok: false, reasons: ["no .pdf file"] }
		}
		// Content beats extension: a renamed file still shows its `%PDF-`
		// magic in the first bytes, and tricks like HTML named .pdf do not.
		// Claim when *any* candidate is a real PDF — a mixed resource with
		// one stray `.pdf`-named file must still open its good documents.
		for (const name of pdfs) {
			const head = new TextDecoder("latin1").decode(
				await api.readFile(name, { end: 64 }),
			)
			if (/^%PDF-\d+\.\d+/.test(head)) return { ok: true }
		}
		return {
			ok: false,
			reasons: [`no .pdf file starts with a %PDF header`],
		}
	},

	async sourceMeta(api) {
		const names = (await api.listFileNames()).filter(isPdfName)
		const stats = await api.statFiles(names)
		let sizeBytes = 0
		for (const stat of stats) sizeBytes += stat?.sizeBytes ?? 0

		const sorted = names
			.map((filename, i) => ({ filename, sizeBytes: stats[i]?.sizeBytes ?? 0 }))
			.sort((a, b) => b.sizeBytes - a.sizeBytes)

		const largest = sorted[0]
		let pageCount: number | undefined
		let version: string | undefined
		if (
			largest !== undefined &&
			largest.sizeBytes <= PAGE_COUNT_READ_MAX_BYTES
		) {
			const bytes = await api.readFile(largest.filename)
			pageCount = countPagesFromBytes(bytes)
			version = pdfVersionFromBytes(bytes)
		}
		return { files: names, pageCount, sizeBytes, version }
	},

	async listFiles(api) {
		const names = (await api.listFileNames()).filter(isPdfName)
		const stats = await api.statFiles(names)
		return names.map((filename, i) => ({
			filename,
			sizeBytes: stats[i]?.sizeBytes ?? 0,
		}))
	},
})
