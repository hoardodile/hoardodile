// Fixture: uses the container API surface gated by the `container`
// manifest permission — without it the sandbox denies the RPC.
export default {
	detect: async (api) => {
		const listing = await api.listContainer("book.cbz")
		return { ok: true, entries: listing.entries.length }
	},
}
