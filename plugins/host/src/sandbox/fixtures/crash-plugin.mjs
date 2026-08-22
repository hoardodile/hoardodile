// Fixture plugin whose module evaluation throws — load must fail.
throw new Error("boom at import")

export default {
	detect: async () => ({ ok: true }),
}
