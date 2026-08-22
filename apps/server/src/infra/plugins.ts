/**
 * Infrastructure plugins shared by every request path: env, DB, storage
 * paths, and the session store. Domain-specific service registrations
 * live alongside their domain (see `src/domain/<name>/plugin.ts`) so
 * adding a new domain does not require editing this file. The matching
 * `FastifyInstance` type augmentations live in
 * `src/infra/fastify-augment.ts`.
 */
import "src/infra/fastify-augment.ts"
import { randomBytes } from "node:crypto"
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import type { Env } from "src/config/env.ts"
import { createSessionStore } from "src/domain/auth/session.ts"
import { createSseBroadcaster } from "src/infra/http/sse-broadcaster.ts"
import {
	createDbHandlesProxy,
	createDbProxy,
	createStoragePathsProxy,
	type RuntimeRefs,
} from "src/infra/runtime-context.ts"
import { createSignalEmitter } from "src/infra/signals.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

export type EnvPluginOpts = { readonly env: Env }

async function envPluginImpl(
	app: FastifyInstance,
	opts: EnvPluginOpts,
): Promise<void> {
	app.decorate("env", opts.env)
}
export const envPlugin = fp(
	envPluginImpl satisfies FastifyPluginAsync<EnvPluginOpts>,
	{
		name: "env-plugin",
	},
)

export type DbPluginOpts = {
	/**
	 * Mutable runtime refs that let the server hot-swap the underlying
	 * SQLite handle without restarting the process. The plugin exposes
	 * Proxy decorators so services created at startup see the current
	 * handle even after a reload.
	 */
	readonly runtimeRefs: RuntimeRefs
	/**
	 * When true, the plugin closes the current handle in `onClose`. Tests
	 * that pass their own handle set this to false and close it themselves.
	 */
	readonly ownsDbHandles: boolean
}

async function dbPluginImpl(
	app: FastifyInstance,
	opts: DbPluginOpts,
): Promise<void> {
	app.decorate("dbHandles", createDbHandlesProxy(opts.runtimeRefs.dbHandles))
	app.decorate("db", createDbProxy(opts.runtimeRefs.dbHandles))
	Object.defineProperty(app, "readOnly", {
		configurable: true,
		enumerable: true,
		get: () => opts.runtimeRefs.readOnly.current,
	})
	if (opts.ownsDbHandles) {
		app.addHook("onClose", async () => {
			opts.runtimeRefs.dbHandles.current.close()
		})
	}
}
export const dbPlugin = fp(
	dbPluginImpl satisfies FastifyPluginAsync<DbPluginOpts>,
	{
		name: "db-plugin",
	},
)

export type PathsPluginOpts = {
	readonly runtimeRefs: RuntimeRefs
}

async function pathsPluginImpl(
	app: FastifyInstance,
	opts: PathsPluginOpts,
): Promise<void> {
	app.decorate("paths", createStoragePathsProxy(opts.runtimeRefs.storagePaths))
}
export const pathsPlugin = fp(
	pathsPluginImpl satisfies FastifyPluginAsync<PathsPluginOpts>,
	{ name: "paths-plugin" },
)

async function signalsPluginImpl(app: FastifyInstance): Promise<void> {
	app.decorate("signals", createSignalEmitter())
}
export const signalsPlugin = fp(
	signalsPluginImpl satisfies FastifyPluginAsync,
	{ name: "signals-plugin" },
)

async function sseBroadcasterPluginImpl(app: FastifyInstance): Promise<void> {
	app.decorate("sseBroadcaster", createSseBroadcaster())
}
export const sseBroadcasterPlugin = fp(
	sseBroadcasterPluginImpl satisfies FastifyPluginAsync,
	{ name: "sse-broadcaster-plugin" },
)

export type SessionsPluginOpts = {
	/**
	 * Override the seal password (>= 32 chars). When omitted, a per-host
	 * key is loaded from `paths.local.sessionKey()`, generating a fresh
	 * one on first boot. Tests pass an inline value to avoid touching disk.
	 */
	readonly password?: string
}

async function sessionsPluginImpl(
	app: FastifyInstance,
	opts: SessionsPluginOpts,
): Promise<void> {
	const password = opts.password ?? loadOrCreateSessionKey(app.paths)
	app.decorate("sessions", createSessionStore({ password }))
}
export const sessionsPlugin = fp(
	sessionsPluginImpl satisfies FastifyPluginAsync<SessionsPluginOpts>,
	{ name: "sessions-plugin", dependencies: ["paths-plugin"] },
)

/**
 * Read the iron-session seal key from disk, generating a 32-byte
 * cryptographically-random secret on first boot. Returned as a 64-char
 * hex string so iron-session sees a printable password far above its
 * 32-character minimum.
 *
 * The key file lives under `local/` (host-only, never synced) and is
 * created with `0o600` so other users on the same machine cannot read it.
 */
function loadOrCreateSessionKey(paths: StoragePaths): string {
	const keyPath = paths.local.sessionKey()
	if (existsSync(keyPath)) {
		const existing = readFileSync(keyPath, "utf8").trim()
		if (existing.length >= 32) return existing
		// File present but corrupt/short -- regenerate; an attacker can't
		// downgrade a key they don't already control.
	}
	mkdirSync(dirname(keyPath), { recursive: true })
	const fresh = randomBytes(32).toString("hex")
	writeFileSync(keyPath, fresh, { encoding: "utf8", mode: 0o600 })
	try {
		chmodSync(keyPath, 0o600)
	} catch {
		// Permission tightening is best-effort on platforms (Windows) where
		// POSIX modes are advisory.
	}
	return fresh
}

/**
 * Factory for the per-domain "decorate the FastifyInstance with a service
 * created from `app.db`/`app.paths`" plugin. Replaces ~20 lines of
 * boilerplate per domain (`<name>Plugin`, `<name>PluginImpl`, the `fp`
 * wrapper). The Fastify module augmentation (`declare module "fastify"`)
 * cannot be hidden inside a generic and still must live in the calling
 * file.
 *
 * @example
 *   declare module "fastify" {
 *     interface FastifyInstance { readonly tagService: TagService }
 *   }
 *   export const tagPlugin = buildServicePlugin({
 *     name: "tag-plugin",
 *     serviceKey: "tagService",
 *     createService: (app) => createTagService({ db: app.db }),
 *     dependencies: ["db-plugin"],
 *   })
 */
export function buildServicePlugin<TService>(opts: {
	readonly name: string
	readonly serviceKey: string
	readonly createService: (app: FastifyInstance) => TService
	readonly dependencies?: readonly string[]
}): FastifyPluginAsync {
	async function pluginImpl(app: FastifyInstance): Promise<void> {
		;(app.decorate as (key: string, value: unknown) => FastifyInstance)(
			opts.serviceKey,
			opts.createService(app),
		)
	}
	return fp(pluginImpl satisfies FastifyPluginAsync, {
		name: opts.name,
		dependencies: opts.dependencies !== undefined ? [...opts.dependencies] : [],
	})
}
