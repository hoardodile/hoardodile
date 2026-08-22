// Fixture plugin that keeps showing API activity for longer than the test
// watchdog window — must NOT be killed.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default {
	detect: async (api) => {
		for (let i = 0; i < 5; i++) {
			await sleep(100)
			await api.statFile("tick")
			api.logInfo("tick", { i })
		}
		return { ok: true }
	},
}
