// Well-behaved fixture: detect returns a huge buffer to prove the
// per-hook result cap turns oversized payloads into hook errors instead of
// cloning them into the host.
export default {
	detect: async () => {
		return new Uint8Array(64 * 1024)
	},
}
