// Hostile fixture: static `node:` imports must be denied by the module
// policy gate before the bundle ever runs — load yields a failing plugin.

import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

export default {
	detect: async () => {
		readFileSync("C:/outside.txt")
		execSync("whoami")
		return { ok: true }
	},
}
