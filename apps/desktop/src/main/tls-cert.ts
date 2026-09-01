/**
 * Self-contained TLS material for the desktop's local-network share.
 *
 * Follows the mkcert-style model: one long-lived root CA plus a signed
 * leaf for the current host. The default client experience is the
 * self-signed "click through once" warning (Option A); a device that
 * installs the root CA (exported via the app) gets a warning-free,
 * CA-trusted session, and leaf renewal under the same CA stays silent.
 *
 * The CA is generated once and cached in app userData; the leaf is
 * re-signed only when the set of reachable LAN addresses changes (so the
 * SAN matches — a mismatched SAN makes Chromium hard-block with no
 * "proceed" affordance).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import forge from "node-forge"

const CA_PREFIX = "lan-ca"
const LEAF_PREFIX = "lan-leaf"
const COMMON_NAME = "hoardodile-lan"
const SERIAL = "01"

export type LanCertMaterial = {
	readonly caPem: string
	readonly caKeyPem: string
	readonly leafPem: string
	readonly leafKeyPem: string
	/** SHA-256 of the leaf DER, lowercase hex — shown to the user so a
	 * client can verify which certificate it is trusting. */
	readonly leafFingerprint: string
}

/**
 * Return a {@link LanCertMaterial} for `addresses`, reusing the cached CA
 * and the cached leaf when the SAN set still matches. Writes nothing until
 * something is actually generated.
 */
export function ensureLanCert(options: {
	readonly dir: string
	readonly addresses: readonly string[]
}): LanCertMaterial {
	const dir = options.dir
	mkdirSync(dir, { recursive: true })
	const unique = [...new Set(options.addresses)].filter((a) => a.length > 0)

	const ca = readOrCreateCa({ dir })
	const leaf = readLeaf(dir)
	const cached = leaf !== undefined && sameAddressSet(leaf, unique)
	if (cached) {
		return {
			caPem: ca.caPem,
			caKeyPem: ca.caKeyPem,
			leafPem: leaf.leafPem,
			leafKeyPem: leaf.leafKeyPem,
			leafFingerprint: leaf.leafFingerprint,
		}
	}
	const fresh = generateLeaf(ca.caCert, ca.caKey, unique)
	writeFileSync(join(dir, `${LEAF_PREFIX}.pem`), fresh.leafPem, "utf8")
	writeFileSync(join(dir, `${LEAF_PREFIX}-key.pem`), fresh.leafKeyPem, "utf8")
	return { caPem: ca.caPem, caKeyPem: ca.caKeyPem, ...fresh }
}

function readOrCreateCa(options: { readonly dir: string }): {
	caPem: string
	caKeyPem: string
	caCert: forge.pki.Certificate
	caKey: forge.pki.rsa.PrivateKey
} {
	const caPemPath = join(options.dir, `${CA_PREFIX}.pem`)
	const caKeyPemPath = join(options.dir, `${CA_PREFIX}-key.pem`)
	if (existsSync(caPemPath) && existsSync(caKeyPemPath)) {
		const caPem = readFileSync(caPemPath, "utf8")
		const caKeyPem = readFileSync(caKeyPemPath, "utf8")
		return {
			caPem,
			caKeyPem,
			caCert: forge.pki.certificateFromPem(caPem),
			caKey: forge.pki.privateKeyFromPem(caKeyPem) as forge.pki.rsa.PrivateKey,
		}
	}
	const keys = forge.pki.rsa.generateKeyPair(2048)
	const cert = forge.pki.createCertificate()
	cert.publicKey = keys.publicKey
	cert.serialNumber = SERIAL
	cert.validity.notBefore = new Date(Date.now() - 60_000)
	cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)
	const subject = [{ name: "commonName", value: COMMON_NAME }]
	cert.setSubject(subject)
	cert.setIssuer(subject)
	cert.setExtensions([
		{ name: "basicConstraints", cA: true },
		{
			name: "keyUsage",
			keyCertSign: true,
			digitalSignature: true,
			crlSign: true,
		},
		{ name: "subjectKeyIdentifier" },
	])
	cert.sign(keys.privateKey, forge.md.sha256.create())
	const caPem = forge.pki.certificateToPem(cert)
	const caKeyPem = forge.pki.privateKeyToPem(keys.privateKey)
	writeFileSync(caPemPath, caPem, "utf8")
	writeFileSync(caKeyPemPath, caKeyPem, "utf8")
	return { caPem, caKeyPem, caCert: cert, caKey: keys.privateKey }
}

function readLeaf(
	dir: string,
):
	| { leafPem: string; leafKeyPem: string; leafFingerprint: string }
	| undefined {
	const leafPemPath = join(dir, `${LEAF_PREFIX}.pem`)
	const leafKeyPemPath = join(dir, `${LEAF_PREFIX}-key.pem`)
	if (!existsSync(leafPemPath) || !existsSync(leafKeyPemPath)) return undefined
	const leafPem = readFileSync(leafPemPath, "utf8")
	return {
		leafPem,
		leafKeyPem: readFileSync(leafKeyPemPath, "utf8"),
		leafFingerprint: fingerprint(leafPem),
	}
}

function generateLeaf(
	caCert: forge.pki.Certificate,
	caKey: forge.pki.rsa.PrivateKey,
	addresses: readonly string[],
): { leafPem: string; leafKeyPem: string; leafFingerprint: string } {
	const keys = forge.pki.rsa.generateKeyPair(2048)
	const cert = forge.pki.createCertificate()
	cert.publicKey = keys.publicKey
	cert.serialNumber = SERIAL
	cert.validity.notBefore = new Date(Date.now() - 60_000)
	cert.validity.notAfter = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
	cert.setSubject([{ name: "commonName", value: COMMON_NAME }])
	cert.setIssuer(caCert.subject.attributes)
	const ipSans = addresses.map((ip) => ({ type: 7 as const, ip }))
	cert.setExtensions([
		{ name: "basicConstraints", cA: false },
		{ name: "keyUsage", digitalSignature: true, keyEncipherment: true },
		{ name: "extKeyUsage", serverAuth: true },
		{ name: "subjectAltName", altNames: ipSans },
		{ name: "subjectKeyIdentifier" },
	])
	cert.sign(caKey, forge.md.sha256.create())
	const leafPem = forge.pki.certificateToPem(cert)
	return {
		leafPem,
		leafKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
		leafFingerprint: fingerprint(leafPem),
	}
}

/** The IP SANs (type 7) stored in a leaf — used to decide whether the cert still covers the current addresses. */
function leafIpSans(leafPem: string): string[] {
	const cert = forge.pki.certificateFromPem(leafPem)
	const ext = cert.getExtension("subjectAltName") as unknown as
		| { altNames?: readonly { type: number; ip?: string }[] }
		| undefined
	if (ext === undefined || ext.altNames === undefined) return []
	return ext.altNames
		.filter((entry) => entry.type === 7 && typeof entry.ip === "string")
		.map((entry) => entry.ip as string)
}

function sameAddressSet(
	leaf: { leafPem: string },
	addresses: readonly string[],
): boolean {
	const current = [...addresses].sort()
	const stored = leafIpSans(leaf.leafPem).sort()
	return (
		current.length === stored.length && current.every((v, i) => v === stored[i])
	)
}

function fingerprint(leafPem: string): string {
	const cert = forge.pki.certificateFromPem(leafPem)
	const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
	const md = forge.md.sha256.create()
	md.update(der)
	return md.digest().toHex()
}

/** A stable cache directory for the LAN certificate keypair under app userData. */
export function lanCertDir(userData: string): string {
	return join(userData, "lan-cert")
}
