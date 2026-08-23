/**
 * Generate minimal sample PDFs for testdata/.
 *
 * The PDFs are hand-built and uncompressed on purpose: the plugin's
 * best-effort page counter scans raw bytes for `/Type /Page` objects,
 * so the fixture must keep object text visible.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, "..", "testdata")

/**
 * Build a minimal valid PDF with `pages` page objects, each holding its
 * own `/Type /Page` object plus a content stream. Offsets are computed
 * while assembling so the xref table is truthful (some viewers tolerate
 * sloppy xrefs, pdf.js does not).
 */
function buildPdf(pages) {
	const objects = []
	const header = "%PDF-1.4\n"
	const pageIds = pages.map((_, i) => 3 + i * 2)

	// Object 1: catalog
	objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
	// Object 2: pages tree
	const kids = pageIds.map((id) => `${id} 0 R`).join(" ")
	objects.push(
		`2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`,
	)

	pageIds.forEach((id, i) => {
		// Page object
		objects.push(
			`${id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>\nendobj\n`,
		)
		// Font object
		objects.push(
			`${id + 1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
		)
		// Content stream: a little text plus a ruler so pages differ.
		const text = `BT /F1 24 Tf 72 700 Td (Page ${i + 1}) Tj ET\n`
		objects.push(
			`${id + 2} 0 obj\n<< /Length ${text.length} >>\nstream\n${text}endstream\nendobj\n`,
		)
	})

	let offset = header.length
	const offsets = [0]
	for (const body of objects) {
		offsets.push(offset)
		offset += Buffer.byteLength(body, "latin1")
	}
	const xrefStart = offset
	let xref = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n"
	for (let i = 1; i < offsets.length; i++) {
		xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
	}
	const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

	return new TextEncoder().encode(header + objects.join("") + xref + trailer)
}

const samples = {
	"two-pages.pdf": buildPdf([1, 2]),
	"three-pages.pdf": buildPdf([1, 2, 3]),
	"fake.pdf": new TextEncoder().encode(
		"This is definitely not a PDF, only a text file wearing the extension.\n",
	),
}

await mkdir(outDir, { recursive: true })
for (const [name, bytes] of Object.entries(samples)) {
	const path = join(outDir, name)
	await writeFile(path, bytes)
	console.log(`wrote ${path} (${bytes.byteLength} bytes)`)
}
