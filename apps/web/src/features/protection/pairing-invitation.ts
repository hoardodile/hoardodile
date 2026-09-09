import { z } from "zod"

/**
 * A pairing address is a bare HTTPS origin — no credentials, query or
 * fragment. `URL` parsing is the only reliable test and it throws on
 * unusable input, so this predicate must stay total: the invite dialog
 * renders before the sender's public address is known (and on an http
 * origin it stays empty), and a throw here would escape `safeParse` into
 * the component render instead of merely failing validation.
 */
function isPairingAddress(value: string): boolean {
	try {
		const url = new URL(value)
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		)
	} catch {
		return false
	}
}

const invitation = z.object({
	format: z.literal("hoardodile-pair-v1"),
	url: z.string().refine(isPairingAddress),
	code: z.string().min(32).max(256),
	fingerprint: z
		.string()
		.regex(/^(?:[a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2}$|^[a-fA-F0-9]{64}$/)
		.optional(),
	expiresAt: z.number().int().positive(),
})

export function parsePairingInvitation(text: string, now = Date.now()) {
	try {
		if (text.length > 8192) return undefined
		const value = invitation.parse(JSON.parse(text))
		return value.expiresAt > now ? value : undefined
	} catch {
		return undefined
	}
}

export function formatPairingInvitation(value: {
	url: string
	code: string
	fingerprint?: string
	expiresAt: number
}) {
	const parsed = invitation.safeParse({
		...value,
		format: "hoardodile-pair-v1",
	})
	return parsed.success ? JSON.stringify(parsed.data, null, 2) : undefined
}
