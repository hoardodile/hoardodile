// Well-behaved fixture plugin: exercises listFiles/readFile/statFile and
// echoes values back so tests can assert RPC routing and binary transfer.
export default {
	detect: async (api) => {
		const files = await api.listFileNames()
		return files.length > 0 ? { ok: true } : { ok: false, reasons: ["empty"] }
	},
	sourceMeta: async (api) => {
		const bytes = await api.readFile("blob.bin")
		return { bytes: Array.from(bytes) }
	},
	// No searchMeta / coverLocal on purpose — tests assert hook presence.
	listFiles: async (api) => {
		const stat = await api.statFile("id")
		return [String(stat?.sizeBytes ?? -1)]
	},
}
