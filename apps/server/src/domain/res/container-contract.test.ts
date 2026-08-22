import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPluginResourceAPI } from "@hoardodile/host"
import type { ContractBackend } from "@hoardodile/host/contract"
import { containerContractSuite } from "@hoardodile/host/contract"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterAll } from "vitest"
import { buildSourceArtifactView } from "./source-view.ts"

const RES_ID = "11111111-1111-4111-8111-111111111111"
const tempRoots: string[] = []

function toBuffer(content: string | Uint8Array): Buffer {
	return Buffer.from(
		typeof content === "string" ? new TextEncoder().encode(content) : content,
	)
}

/**
 * The server's own artifact view as a contract backend: the res domain
 * proves its bare-file reading conforms to the same container contract
 * the host's fixture/directory backends are held to.
 */
const SERVER_VIEW_BACKEND: ContractBackend = {
	name: "server artifact view",
	build: async (files) => {
		const root = mkdtempSync(join(tmpdir(), "server-contract-"))
		tempRoots.push(root)
		const paths = createStoragePaths({ root })
		const fileVersion = paths.latestVersion
		const resDir = paths.atVersion(fileVersion).resource(RES_ID)
		await mkdir(resDir, { recursive: true })
		for (const [name, content] of Object.entries(files)) {
			const abs = join(resDir, name)
			await mkdir(join(abs, ".."), { recursive: true })
			await writeFile(abs, toBuffer(content))
		}
		const view = buildSourceArtifactView({ paths }, RES_ID, fileVersion, {
			kind: "dir",
			dirPath: resDir,
		})
		return createPluginResourceAPI({ view })
	},
}

containerContractSuite([SERVER_VIEW_BACKEND])

afterAll(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true })
	}
})
