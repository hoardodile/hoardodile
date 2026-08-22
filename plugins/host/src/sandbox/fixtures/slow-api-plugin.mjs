/**
 * Fixture: detect() awaits a single host-side API call. Paired with a slow
 * host readFile stub and a short watchdog, it proves the watchdog tolerates
 * host work that outlasts the activity window.
 */
export default {
	async detect(api) {
		const bytes = await api.readFile("big.bin")
		return { ok: bytes.length > 0 }
	},
}
