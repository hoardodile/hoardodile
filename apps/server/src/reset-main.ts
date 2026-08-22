/**
 * Executable wrapper for the reset CLI: removes the configured admin
 * password so the web setup flow can claim the instance again. This is
 * the recovery path for a forgotten password -- there is no way to bypass
 * login from the browser.
 */

import { loadEnv, loadWorkspaceEnvFile } from "src/config/env.ts"
import { clearAuthPassword } from "src/runtime.ts"

// Resolves the repo-root `.env` from the bundle location too, so the built
// `reset-main.js` honours the same STORAGE_ROOT as the running server.
// Packaged installs inject env from the parent process instead.
if (process.env.HOARDODILE_PACKAGED !== "1") {
	loadWorkspaceEnvFile()
}

const env = loadEnv(process.env)
clearAuthPassword(env)
process.stdout.write(
	"app: admin password removed; set a new one in the browser\n",
)
