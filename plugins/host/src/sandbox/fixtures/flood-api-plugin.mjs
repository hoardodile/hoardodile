// Fixture: exceeds the per-hook API-call budget to prove a runaway RPC
// fan-out fails the hook instead of pinning the host's CPU.
export default {
	detect: async (api) => {
		for (let i = 0; i < 30; i++) await api.listFileNames()
		return { ok: true }
	},
}
