import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, test } from "vitest"
import { createPluginResourceAPI } from "../api.ts"
import { createDirectoryContainer } from "../directory-container.ts"
import { createPluginSandbox, DEFAULT_SANDBOX_CONFIG } from "../sandbox/host.ts"
import { createContainerFixture } from "./container-fixture.ts"
import { type ContractBackend, containerContractSuite } from "./suite.ts"

const tempRoots: string[] = []

function withTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "host-contract-"))
	tempRoots.push(dir)
	return dir
}

const FIXTURE_BACKEND: ContractBackend = {
	name: "fixture",
	build: async (files) =>
		createPluginResourceAPI({ view: createContainerFixture({ files }) }),
}

const DIRECTORY_BACKEND: ContractBackend = {
	name: "directory",
	build: async (files) => {
		const dir = withTempDir()
		for (const [name, content] of Object.entries(files)) {
			const abs = join(dir, name)
			mkdirSync(dirname(abs), { recursive: true })
			writeFileSync(
				abs,
				Buffer.from(
					typeof content === "string"
						? new TextEncoder().encode(content)
						: content,
				),
			)
		}
		return createPluginResourceAPI({ view: createDirectoryContainer(dir) })
	},
}

describe("container contract suite", () => {
	containerContractSuite([FIXTURE_BACKEND, DIRECTORY_BACKEND])

	test("sandboxed hooks see identical results across backends", async () => {
		const files = { "blob.bin": Uint8Array.from([1, 2, 3, 4, 250]) }
		const sandbox = createPluginSandbox({
			...DEFAULT_SANDBOX_CONFIG,
			watchdogMs: 5_000,
			hardTimeoutMs: 10_000,
		})
		try {
			const mainPath = fileURLToPath(
				new URL("../sandbox/fixtures/echo-plugin.mjs", import.meta.url),
			)
			const plugin = await sandbox.loadPlugin({
				id: "echo-contract",
				mainPath,
				eager: false,
			})
			if (plugin === undefined) {
				throw new Error("echo fixture failed to load")
			}
			const detect = plugin.detect
			const sourceMeta = plugin.sourceMeta
			const listFiles = plugin.listFiles
			if (
				detect === undefined ||
				sourceMeta === undefined ||
				listFiles === undefined
			) {
				throw new Error("echo fixture missing hooks")
			}

			const outputs: unknown[] = []
			for (const backend of [FIXTURE_BACKEND, DIRECTORY_BACKEND]) {
				const api = await backend.build(files)
				outputs.push([
					await detect(api),
					await sourceMeta(api),
					await listFiles(api),
				])
			}
			for (let i = 1; i < outputs.length; i++) {
				expect(outputs[i]).toEqual(outputs[0])
			}
		} finally {
			await sandbox.disposeAll()
		}
	})
})

afterAll(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true })
	}
})
