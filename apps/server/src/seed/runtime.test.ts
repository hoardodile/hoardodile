import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "src/config/env.ts"
import { getAuthRow } from "src/domain/auth/repo.ts"
import { schema } from "src/infra/db/connection.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, expect, it } from "vitest"
import { fillDemoLibrary } from "./fill.ts"
import { prepareSeedRoot } from "./fresh.ts"
import { emptySeedManifest, writeSeedManifestToRoot } from "./manifest.ts"
import { openSeedRuntime, type SeedRuntime } from "./runtime.ts"

let root: string | undefined
let runtime: SeedRuntime | undefined
let built: BuiltServer | undefined

afterEach(async () => {
	await built?.close()
	built = undefined
	await runtime?.close()
	runtime = undefined
	if (root !== undefined) await rm(root, { recursive: true, force: true })
	root = undefined
})

it("seeds host credentials and devices directly and can reopen without migration", async () => {
	root = await mkdtemp(join(tmpdir(), "seed-host-state-"))
	prepareSeedRoot(root, { dryRun: false })
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		STORAGE_ROOT: root,
		DISABLE_DEV_PLUGINS: "true",
	})
	runtime = await openSeedRuntime(env)
	const device = await runtime.sync.deviceCreate({ name: "Demo device" })
	expect(runtime.db.db.select().from(schema.syncDevices).all()).toEqual([])
	expect(
		runtime.hostDb.db.select().from(schema.syncDevices).all(),
	).toHaveLength(1)
	const manifest = { ...emptySeedManifest(), status: "complete" as const }
	writeSeedManifestToRoot(root, manifest)
	const options = { cacheDir: join(root, "media-cache"), skipDownload: true }
	await expect(fillDemoLibrary(runtime, options)).rejects.toThrow("sync device")
	expect(getAuthRow(runtime.hostDb.db)).toBeUndefined()
	manifest.syncDevices.push(device.id)
	writeSeedManifestToRoot(root, manifest)
	await fillDemoLibrary(runtime, options)
	const password = getAuthRow(runtime.hostDb.db)?.hash
	expect(password).toBeTruthy()
	expect(getAuthRow(runtime.db.db)).toBeUndefined()
	await fillDemoLibrary(runtime, options)
	expect(getAuthRow(runtime.hostDb.db)?.hash).toBe(password)
	await runtime.close()
	runtime = undefined
	built = await buildServer({ env })
	const response = await built.app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { password: "demo" },
	})
	expect(response.statusCode).toBe(200)
}, 30000)
