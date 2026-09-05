import { expect, it } from "vitest"
import {
	formatPairingInvitation,
	parsePairingInvitation,
} from "./pairing-invitation"

const value = {
	url: "https://192.168.1.2:3443/",
	code: "a".repeat(32),
	fingerprint: "b".repeat(64),
	expiresAt: 1000,
}

it("round-trips an invitation without dropping its self-signed certificate pin", () => {
	const text = formatPairingInvitation(value)
	expect(parsePairingInvitation(text!, 999)).toEqual({
		format: "hoardodile-pair-v1",
		...value,
	})
})

it("rejects expired, malformed, oversized, and insecure invitations", () => {
	expect(
		parsePairingInvitation(formatPairingInvitation(value)!, 1000),
	).toBeUndefined()
	expect(parsePairingInvitation("not-json", 0)).toBeUndefined()
	expect(parsePairingInvitation("x".repeat(8193), 0)).toBeUndefined()
	for (const url of [
		"http://192.168.1.2/",
		"https://user:password@example.com/",
		"https://example.com/?token=secret",
	])
		expect(formatPairingInvitation({ ...value, url })).toBeUndefined()
	expect(
		formatPairingInvitation({ ...value, fingerprint: "invalid" }),
	).toBeUndefined()
})
