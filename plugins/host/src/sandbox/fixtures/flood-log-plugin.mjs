// Fixture: exceeds the per-hook log budget to prove a log flood fails
// the hook instead of resetting the watchdog forever.
export default {
	detect: async (api) => {
		for (let i = 0; i < 30; i++) api.logInfo(`spam ${i}`)
		return { ok: true }
	},
}
