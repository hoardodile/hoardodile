import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { createStoragePaths } from "./paths.ts"
import { writeVersioned } from "./write-versioned.ts"

describe("writeVersioned", () => {
	test("throws DomainError when readOnly is true", async () => {
		const root = await mkdtemp(join(tmpdir(), "write-versioned-ro-"))
		try {
			const paths = createStoragePaths({ root })
			await expect(
				writeVersioned(paths, true, async () => "should not run"),
			).rejects.toMatchObject({
				code: "CONFLICT",
				kind: "server.read_only_archive",
				message:
					"server is viewing a read-only archive; versioned writes are blocked",
			})
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test("executes command on paths.latest when readOnly is false", async () => {
		const root = await mkdtemp(join(tmpdir(), "write-versioned-ok-"))
		try {
			const paths = createStoragePaths({ root })
			const result = await writeVersioned(paths, false, async (current) => {
				const dir = current.resource("res-1")
				await mkdir(dir, { recursive: true })
				const file = join(dir, "blob")
				await writeFile(file, "data")
				return file
			})
			expect(result.startsWith(paths.latest.resource("res-1"))).toBe(true)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test("callback always receives the current version even when viewing an older version", async () => {
		const root = await mkdtemp(join(tmpdir(), "write-versioned-version-"))
		try {
			// Prepare two version directories and pin active to v1 while current is v2.
			await mkdir(join(root, "versions", "1"), { recursive: true })
			await mkdir(join(root, "versions", "2"), { recursive: true })
			const paths = createStoragePaths({
				root,
				activeVersion: 1,
				latestVersion: 2,
			})
			expect(paths.active.version).toBe(1)
			expect(paths.latest.version).toBe(2)

			const receivedVersion = await writeVersioned(
				paths,
				false,
				async (current) => current.version,
			)
			expect(receivedVersion).toBe(2)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
