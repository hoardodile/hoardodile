/** Fixture: emits one log line per level so the host-side sink is observable. */
export default {
	async detect(api) {
		api.logInfo("hello", { i: 1 })
		api.logWarn("careful")
		api.logError("bad news")
		return { ok: true }
	},
}
