import { z } from "zod"

const invitation = z.object({
	format: z.literal("hoardodile-pair-v1"),
	url: z.url().refine((value) => {
		const url = new URL(value)
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		)
	}),
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
