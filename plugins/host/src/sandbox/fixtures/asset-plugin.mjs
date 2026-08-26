// Sandbox fixture: exercises the plugin asset API within detect — reads
// the vault stat, performs a consent-gated single download and a batch
// download. Used to verify the manifest permission gate and the wired
// plugin asset handler (single in → single out, array in → array out).
export default {
	detect: async (api) => {
		const stat = await api.statAsset("runtime/a.mjs")
		const downloaded = await api.download({
			url: "https://example.com/runtime/a.mjs",
			dest: "runtime/a.mjs",
		})
		const batched = await api.download([
			{ url: "https://example.com/runtime/b.mjs", dest: "runtime/b.mjs" },
			{ url: "https://example.com/runtime/c.mjs", dest: "runtime/c.mjs" },
		])
		return { ok: true, stat, downloaded, batched }
	},
}
