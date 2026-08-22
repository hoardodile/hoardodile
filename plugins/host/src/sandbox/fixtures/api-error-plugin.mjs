// Fixture plugin that surfaces host-side API errors through the RPC boundary.
export default {
	detect: async (api) => {
		try {
			await api.readFile("missing.bin")
		} catch (err) {
			return { ok: false, reasons: [`api said: ${err.message}`] }
		}
		return { ok: true }
	},
}
