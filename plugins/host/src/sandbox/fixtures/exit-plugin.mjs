// Fixture plugin that kills its own worker thread when invoked.
export default {
	detect: async () => {
		process.exit(1)
	},
}
