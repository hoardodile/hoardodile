import { spawn } from "node:child_process"
import { setDefaultResultOrder } from "node:dns"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { build, createServer } from "vite"

setDefaultResultOrder("ipv4first")

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(root, "../..")
const require = createRequire(import.meta.url)
const electronExe = require("electron")
const wizardUrl = "http://127.0.0.1:5174/"
const webDestUrl = process.env.HOARDODILE_WEB_URL ?? "http://127.0.0.1:5173"

console.log(
	`[desktop] SPA HMR expects ${webDestUrl} — run \`pnpm dest\` in another terminal`,
)

const wizard = await createServer({
	configFile: resolve(root, "vite.wizard.config.ts"),
	server: {
		host: "127.0.0.1",
		port: 5174,
		strictPort: true,
		origin: wizardUrl.slice(0, -1),
	},
})
await wizard.listen()
wizard.printUrls()
await waitForHttp(wizardUrl)

await build({
	configFile: resolve(root, "vite.main.config.ts"),
})
await build({
	configFile: resolve(root, "vite.preload.config.ts"),
})

const child = spawn(electronExe, [root], {
	cwd: root,
	stdio: "inherit",
	env: {
		...process.env,
		ELECTRON_WIZARD_URL: wizardUrl,
		HOARDODILE_WEB_URL: webDestUrl,
		HOARDODILE_WORKSPACE: workspaceRoot,
	},
})

function shutdown() {
	child.kill()
	void wizard.close()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
child.on("exit", (code) => {
	void wizard.close()
	process.exit(code ?? 0)
})

async function waitForHttp(url) {
	const deadline = Date.now() + 15_000
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(1_000) })
			if (res.ok) return
		} catch {
			// not listening yet
		}
		await delay(150)
	}
	throw new Error(`wizard dest server did not accept ${url}`)
}
