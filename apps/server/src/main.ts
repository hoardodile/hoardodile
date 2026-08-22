/**
 * Standalone server entry point.
 *
 * Configuration is read entirely from environment variables (see
 * {@link loadEnv}). There is no CLI surface: no flags, no prompts, no
 * --help/--version. First-run setup happens in the browser: when no admin
 * password is configured yet, the login page turns into a setup form and
 * the first visitor claims the instance. `app-server-reset` is the only
 * CLI, and it exists purely as a recovery path for a forgotten password.
 */

import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv, loadWorkspaceEnvFile } from "src/config/env.ts"
import { isAuthConfigured, launchHttpServer } from "src/runtime.ts"

async function main(): Promise<void> {
	if (process.env.HOARDODILE_PACKAGED !== "1") {
		loadWorkspaceEnvFile()
	}
	const env = loadEnv(process.env)

	const webRoot = resolveWebRoot(env)
	const server = await launchHttpServer({ env, webRoot })
	installShutdownHandlers(server.built)

	server.built.app.log.info(
		{
			host: server.host,
			port: server.port,
			storageRoot: env.STORAGE_ROOT,
			webRoot: webRoot ?? null,
		},
		"app server listening",
	)

	// The instance is unclaimed: whoever reaches it first can set the
	// password. Surface this loudly instead of silently serving an open
	// instance.
	if (!isAuthConfigured(env)) {
		server.built.app.log.warn(
			{ url: `http://${server.host}:${server.port}` },
			"app: no admin password configured; open the app in a browser to set one",
		)
	}
}

/**
 * Resolve the directory of pre-built web assets to serve at `/`.
 *
 *  1. `APP_WEB_ROOT` env var.
 *  2. The bundled `<dist>/web/` folder shipped next to `main.js`.
 *  3. Otherwise undefined -> tRPC/HTTP only, no SPA mount.
 */
function resolveWebRoot(env: ReturnType<typeof loadEnv>): string | undefined {
	if (env.APP_WEB_ROOT !== undefined && env.APP_WEB_ROOT.length > 0) {
		return resolve(env.APP_WEB_ROOT)
	}
	const bundled = bundledWebRoot()
	if (bundled !== undefined && existsSync(join(bundled, "index.html"))) {
		return bundled
	}
	return undefined
}

function bundledWebRoot(): string | undefined {
	try {
		const here = fileURLToPath(import.meta.url)
		return join(dirname(here), "web")
	} catch {
		return undefined
	}
}

function installShutdownHandlers(server: {
	readonly app: {
		log: {
			info: (obj: unknown, msg: string) => void
			fatal: (obj: unknown, msg: string) => void
		}
	}
	readonly close: () => Promise<void>
}): void {
	const stopSignals = ["SIGINT", "SIGTERM"] as const
	let shuttingDown = false
	async function shutdown(signal: string): Promise<void> {
		if (shuttingDown) return
		shuttingDown = true
		server.app.log.info({ signal }, "shutting down")
		try {
			await server.close()
			process.exit(0)
		} catch (err) {
			server.app.log.fatal({ err }, "error during shutdown")
			process.exit(1)
		}
	}
	for (const sig of stopSignals) {
		process.on(sig, () => {
			void shutdown(sig)
		})
	}
	process.on("uncaughtException", (err) => {
		server.app.log.fatal({ err }, "uncaughtException")
		void server
			.close()
			.catch(() => {})
			.finally(() => process.exit(1))
	})
	process.on("unhandledRejection", (reason) => {
		server.app.log.fatal({ reason }, "unhandledRejection")
		void server
			.close()
			.catch(() => {})
			.finally(() => process.exit(1))
	})
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err)
	process.stderr.write(`${message}\n`)
	process.exit(1)
})
