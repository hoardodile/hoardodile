import { type Zippable, zipSync } from "fflate"
import { formatDiagnostics } from "@/lib/clientLog"
import { trpcQuery } from "@/trpc/factory"

/** Cap the amount of the in-memory ring that goes into the archive. */
const ARCHIVE_LOG_LINES = 200

const ZIP_MIME = "application/zip"

/**
 * Build and download `hoardodile-logs-<timestamp>.zip`: the frontend log
 * (`frontend.log` — app identity plus the recent captured entries) and the
 * server's own rolling log files (pino-redacted server-side and re-redacted
 * for the storage root / private IPs before they leave the host).
 *
 * The archive is only ever downloaded to the user's machine and attached by
 * hand — nothing is sent anywhere automatically.
 */
export async function downloadLogArchive(): Promise<void> {
	const serverLogs = await trpcQuery("diagnostics", "logs")
	const files: Zippable = {
		"frontend.log": encode(formatDiagnostics(ARCHIVE_LOG_LINES)),
	}
	for (const file of serverLogs.files) {
		files[file.name] = encode(file.content)
	}

	const bytes = zipSync(files, { level: 6 })
	const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
	const url = URL.createObjectURL(new Blob([bytes], { type: ZIP_MIME }))
	try {
		const anchor = document.createElement("a")
		anchor.href = url
		anchor.download = `hoardodile-logs-${stamp}.zip`
		document.body.appendChild(anchor)
		anchor.click()
		anchor.remove()
	} finally {
		URL.revokeObjectURL(url)
	}
}

function encode(text: string): Uint8Array {
	return new TextEncoder().encode(text)
}
