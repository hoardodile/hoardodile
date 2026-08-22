// Fixture plugin that reads a byte range — asserts the range argument
// crosses the sandbox RPC boundary intact.
export default {
	detect: async () => ({ ok: true }),
	sourceMeta: async (api) => {
		const bytes = await api.readFile("blob.bin", { start: 1, end: 4 })
		return { bytes: Array.from(bytes) }
	},
}
