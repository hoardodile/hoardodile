// Hostile fixture: a computed dynamic import of a denied builtin. Static
// scans cannot catch it — the runtime policy gate must.
export default {
	detect: async () => {
		const mod = await import("node:" + "fs")
		mod.readFileSync("/outside.txt")
		return { ok: true }
	},
}
