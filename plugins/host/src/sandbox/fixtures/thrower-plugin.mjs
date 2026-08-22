// Fixture plugin that throws inside a hook — the error must cross the
// boundary with its message intact.
export default {
	detect: async () => {
		throw new Error("hook exploded")
	},
}
