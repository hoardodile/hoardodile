// Sandbox fixture: exercises the plugin asset API within detect — reads
// the vault stat, then performs a consent-gated download. Used to verify
// the manifest permission gate and the wired plugin asset handler.
export default {
	detect: async (api) => {
		const stat = await api.statAsset("runtime/a.mjs")
		const downloaded = await api.download({
			url: "https://example.com/runtime/a.mjs",
			dest: "runtime/a.mjs",
		})
		return { ok: true, stat, downloaded }
	},
}
