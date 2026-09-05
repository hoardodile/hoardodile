import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type RecoveryManifest, sha256File } from "@hoardodile/backup"
import { expect, it } from "vitest"
import { validateRecoveryMetadata } from "./recovery-metadata.ts"

it("rejects a newer plugin requirement before any target library is opened", async () => {
	const root = await mkdtemp(join(tmpdir(), "hd-plugin-compatibility-"))
	try {
		const id = randomUUID()
		const directory = join(root, "1", "plugins", id)
		await mkdir(directory, { recursive: true })
		const path = join(directory, "manifest.json")
		await writeFile(
			path,
			JSON.stringify({
				id,
				version: "1.0.0",
				name: "Future plugin",
				description: "Compatibility fixture",
				minAppVersion: "99.0.0",
			}),
		)
		const manifest: RecoveryManifest = {
			formatVersion: 1,
			recoveryPointId: randomUUID(),
			instanceId: randomUUID(),
			libraryId: randomUUID(),
			createdAt: Date.now(),
			appVersion: "99.0.0",
			latestVersion: 1,
			databasePath: "1/checkpoint/app.sqlite",
			databaseSha256: "a".repeat(64),
			databaseSchema: "test",
			plugins: [
				{
					id,
					version: "1.0.0",
					archiveVersion: 1,
					manifestSha256: await sha256File(path),
				},
			],
		}
		await expect(
			validateRecoveryMetadata({
				metadataRoot: root,
				manifest,
				files: new Set([`1/plugins/${id}/manifest.json`]),
				appVersion: "1.0.0",
				validateDatabase: async () => {},
			}),
		).rejects.toMatchObject({ code: "unsupported_plugin" })
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
