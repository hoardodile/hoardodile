/**
 * e2e fixture plugin: a hand-written plugin bundle (zero imports, so it
 * works without any SDK build step) whose only real behavior is the
 * install-time consent download. The spec (`plugin-install-consent.spec.ts`)
 * substitutes `__E2E_RUNTIME_URL__` / `__E2E_DEST__` and zips this file
 * together with a generated manifest.
 *
 * `detect` always misses so the fixture never claims a resource — it must
 * not disturb any other spec sharing the run's storage.
 */
const RUNTIME_URL = "__E2E_RUNTIME_URL__"
const DEST = "__E2E_DEST__"

export default {
	detect: async () => ({ ok: false, reasons: ["e2e fixture never claims"] }),
	onInstall: async (api) => {
		await api.download({ url: RUNTIME_URL, dest: DEST })
	},
}
