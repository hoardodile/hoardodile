// Fixture plugin that keeps logging (watchdog activity) but never returns —
// only the hard timeout can stop it.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default {
	detect: async (api) => {
		for (;;) {
			api.logInfo("still alive")
			await sleep(50)
		}
	},
}
