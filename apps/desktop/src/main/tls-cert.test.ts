/**
 * @vitest-environment node
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import forge from "node-forge"
import { afterEach, describe, expect, it } from "vitest"
import { ensureLanCert } from "./tls-cert.ts"

const scratch: string[] = []

afterEach(() => {
	for (const dir of scratch.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "hd-lan-cert-"))
	scratch.push(dir)
	return dir
}

function leafSanIps(leafPem: string): string[] {
	const cert = forge.pki.certificateFromPem(leafPem)
	const ext = cert.getExtension("subjectAltName") as unknown as {
		altNames?: readonly { type: number; ip?: string }[]
	}
	const sans = ext.altNames ?? []
	return sans
		.filter((entry) => entry.type === 7 && typeof entry.ip === "string")
		.map((entry) => entry.ip as string)
}

describe("ensureLanCert", () => {
	it("generates a CA and a leaf with the requested IP SANs", () => {
		const dir = tempDir()
		const material = ensureLanCert({ dir, addresses: ["192.168.1.20"] })
		expect(material.caPem).toContain("BEGIN CERTIFICATE")
		expect(material.caKeyPem).toContain("RSA PRIVATE KEY")
		expect(material.leafPem).toContain("BEGIN CERTIFICATE")
		expect(material.leafKeyPem).toContain("RSA PRIVATE KEY")
		expect(material.leafFingerprint).toMatch(/^[0-9a-f]{64}$/)
		expect(leafSanIps(material.leafPem)).toEqual(["192.168.1.20"])
		expect(existsSync(join(dir, "lan-ca.pem"))).toBe(true)
		expect(existsSync(join(dir, "lan-leaf.pem"))).toBe(true)
	})

	it("reuses the cached CA and leaf when the address set is unchanged", () => {
		const dir = tempDir()
		const first = ensureLanCert({
			dir,
			addresses: ["192.168.1.20", "10.0.0.5"],
		})
		const second = ensureLanCert({
			dir,
			addresses: ["10.0.0.5", "192.168.1.20"],
		})
		expect(second.leafFingerprint).toBe(first.leafFingerprint)
		expect(second.caPem).toBe(first.caPem)
		expect(leafSanIps(second.leafPem)).toEqual(["192.168.1.20", "10.0.0.5"])
	})

	it("re-signs the leaf (same CA) when the address set changes", () => {
		const dir = tempDir()
		const first = ensureLanCert({ dir, addresses: ["192.168.1.20"] })
		const second = ensureLanCert({ dir, addresses: ["192.168.1.99"] })
		expect(second.leafFingerprint).not.toBe(first.leafFingerprint)
		expect(second.caPem).toBe(first.caPem)
		expect(leafSanIps(second.leafPem)).toEqual(["192.168.1.99"])
	})

	it("persists the material so a later call survives without regeneration", () => {
		const dir = tempDir()
		const first = ensureLanCert({ dir, addresses: ["192.168.1.20"] })
		// A fresh call against the same directory observes the on-disk state.
		const second = ensureLanCert({ dir, addresses: ["192.168.1.20"] })
		expect(second.leafFingerprint).toBe(first.leafFingerprint)
	})

	it("dedupes addresses and tolerates an empty address set", () => {
		const dir = tempDir()
		const deduped = ensureLanCert({
			dir,
			addresses: ["192.168.1.20", "192.168.1.20", ""],
		})
		expect(leafSanIps(deduped.leafPem)).toEqual(["192.168.1.20"])

		const empty = ensureLanCert({ dir: tempDir(), addresses: [] })
		expect(empty.leafPem).toContain("BEGIN CERTIFICATE")
		expect(leafSanIps(empty.leafPem)).toEqual([])
	})
})
