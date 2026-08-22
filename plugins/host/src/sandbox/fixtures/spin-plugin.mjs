// Fixture plugin with a synchronous infinite loop: never yields to the event
// loop and never calls the API — the watchdog must kill it.
export default {
	detect: async () => {
		for (;;) {
			// spin
		}
	},
}
