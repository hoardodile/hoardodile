import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto"
import { sealData, unsealData } from "iron-session"

export type Session = {
	readonly id: string
	readonly createdAt: number
	readonly expiresAt: number
}

/** How much of the TTL must remain before we skip a refresh. */
const REFRESH_THRESHOLD_RATIO = 0.5

/**
 * Sealed cookie payload. We carry our own `expiresAt` because iron-session's
 * `ttl` is fixed at seal time and we need a sliding-window refresh policy.
 */
type SessionPayload = Session

/** Result of any operation that may issue a refreshed cookie. */
export type IssuedSession = {
	readonly session: Session
	/** Sealed cookie value to write back to the response. */
	readonly sealed: string
}

/** Result of {@link SessionStore.touch}. */
export type TouchedSession = {
	readonly session: Session
	/**
	 * Re-sealed cookie value when the sliding window pushed `expiresAt`
	 * forward. `undefined` means the caller does not need to rewrite the
	 * cookie (more than half the TTL remains).
	 */
	readonly sealed: string | undefined
}

/**
 * Stateless session store backed by `iron-session`'s authenticated
 * encryption. The cookie value carries a sealed (`session`, `expiresAt`)
 * payload; the server holds no per-user state and there is no background
 * sweep.
 *
 * Trade-offs: we cannot revoke a session before its TTL elapses without
 * a deny-list. Acceptable for this single-user desktop app -- explicit
 * logout simply clears the cookie on the response.
 */
export type FileToken = {
	readonly sealed: string
	readonly expiresAt: number
}

export type SessionStore = {
	/** Issue a brand-new sealed session. */
	create(ttlSeconds: number, now?: number): Promise<IssuedSession>
	/** Decode a cookie; returns `undefined` when missing/invalid/expired. */
	read(sealed: string | undefined, now?: number): Promise<Session | undefined>
	/**
	 * Sliding-window refresh: returns the (possibly re-sealed) session.
	 * `sealed === undefined` in the result means no cookie rewrite needed.
	 * Returns `undefined` when the cookie is missing/invalid/expired.
	 */
	touch(
		sealed: string | undefined,
		ttlSeconds: number,
		now?: number,
	): Promise<TouchedSession | undefined>
	/**
	 * Issue a fresh session, replacing any previous one. With cookie-based
	 * sessions there is nothing server-side to delete; the caller is
	 * expected to overwrite the previous cookie with the new sealed value.
	 */
	rotate(ttlSeconds: number, now?: number): Promise<IssuedSession>
	/** Issue a 24 h stateless HMAC-signed token for plugin iframes. */
	createToken(
		ttlSeconds: number,
		resId: string,
		now?: number,
	): Promise<FileToken>
	/**
	 * Verify a session token. Returns the session id and the resource the
	 * token is bound to if valid, otherwise `undefined`.
	 */
	verifyToken(
		sealed: string | undefined,
		now?: number,
	): Promise<{ readonly sessionId: string; readonly resId: string } | undefined>
}

export type SessionStoreOptions = {
	/** Iron-session seal password. Must be at least 32 characters. */
	readonly password: string
}

/** Derive an HMAC key for file tokens, domain-separated from iron-session. */
export function deriveTokenKey(password: string): Buffer {
	return createHash("sha256").update(`file-token:${password}`).digest()
}

/**
 * Create a stateless HMAC-signed token bound to a single resource. The
 * token embeds its own expiry and is self-authenticating — no server-side
 * storage needed.
 */
export function createToken(
	tokenKey: Buffer,
	ttlSeconds: number,
	resId: string,
	now: number = Date.now(),
): FileToken {
	const randomId = randomBytes(8).toString("base64url")
	const expiresAt = now + ttlSeconds * 1000
	const expiry = expiresAt.toString(36)
	const payload = `${randomId}.${expiry}.${resId}`
	const hmac = createHmac("sha256", tokenKey)
		.update(payload)
		.digest()
		.subarray(0, 16)
		.toString("base64url")
	return { sealed: `${payload}.${hmac}`, expiresAt }
}

/**
 * Verify an HMAC-signed token. Returns `{ sessionId: "ok", resId }` when
 * valid, or `undefined` when missing, expired, or tampered. The returned
 * `resId` is the resource the token is scoped to — callers must compare
 * it against the resource the request actually targets.
 */
export function verifyToken(
	tokenKey: Buffer,
	sealed: string | undefined,
	now: number = Date.now(),
): { readonly sessionId: string; readonly resId: string } | undefined {
	if (sealed === undefined || sealed === "") return undefined
	const parts = sealed.split(".")
	if (parts.length !== 4) return undefined
	const [randomId, expiryStr, resId, sig] = parts as (string | undefined)[]
	if (
		randomId === undefined ||
		expiryStr === undefined ||
		resId === undefined ||
		sig === undefined
	) {
		return undefined
	}
	const expiry = parseInt(expiryStr, 36)
	if (!Number.isFinite(expiry) || expiry <= now) return undefined
	const payload = `${randomId}.${expiryStr}.${resId}`
	const expectedSig = createHmac("sha256", tokenKey)
		.update(payload)
		.digest()
		.subarray(0, 16)
		.toString("base64url")
	if (
		expectedSig.length !== sig.length ||
		!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
	) {
		return undefined
	}
	return { sessionId: "ok", resId }
}

/**
 * Construct a {@link SessionStore} sealed with the given password.
 *
 * @throws when `opts.password` is shorter than 32 chars
 *   (iron-session's lower bound for AES-256 derivation).
 */
export function createSessionStore(opts: SessionStoreOptions): SessionStore {
	if (opts.password.length < 32) {
		throw new Error("session password must be at least 32 characters")
	}
	const password = opts.password
	const tokenKey = deriveTokenKey(password)

	async function seal(payload: SessionPayload): Promise<string> {
		return sealData(payload, { password, ttl: 0 })
	}

	async function unseal(value: string): Promise<SessionPayload | undefined> {
		try {
			const data = await unsealData<SessionPayload>(value, {
				password,
				ttl: 0,
			})
			if (
				typeof data.id !== "string" ||
				typeof data.createdAt !== "number" ||
				typeof data.expiresAt !== "number"
			) {
				return undefined
			}
			return data
		} catch {
			return undefined
		}
	}

	async function create(
		ttlSeconds: number,
		now: number = Date.now(),
	): Promise<IssuedSession> {
		const session: Session = {
			id: newSessionId(),
			createdAt: now,
			expiresAt: now + ttlSeconds * 1000,
		}
		const sealed = await seal(session)
		return { session, sealed }
	}

	async function read(
		sealed: string | undefined,
		now: number = Date.now(),
	): Promise<Session | undefined> {
		if (sealed === undefined || sealed === "") return undefined
		const data = await unseal(sealed)
		if (data === undefined) return undefined
		if (data.expiresAt <= now) return undefined
		return data
	}

	async function touch(
		sealed: string | undefined,
		ttlSeconds: number,
		now: number = Date.now(),
	): Promise<TouchedSession | undefined> {
		const existing = await read(sealed, now)
		if (existing === undefined) return undefined
		const remainingMs = existing.expiresAt - now
		const ttlMs = ttlSeconds * 1000
		if (remainingMs > ttlMs * REFRESH_THRESHOLD_RATIO) {
			return { session: existing, sealed: undefined }
		}
		const refreshed: Session = { ...existing, expiresAt: now + ttlMs }
		return { session: refreshed, sealed: await seal(refreshed) }
	}

	async function rotate(
		ttlSeconds: number,
		now: number = Date.now(),
	): Promise<IssuedSession> {
		return create(ttlSeconds, now)
	}

	return {
		create,
		read,
		touch,
		rotate,
		createToken: (ttlSeconds, resId, now) =>
			Promise.resolve(createToken(tokenKey, ttlSeconds, resId, now)),
		verifyToken: (sealed, now) =>
			Promise.resolve(verifyToken(tokenKey, sealed, now)),
	}
}

function newSessionId(): string {
	return randomBytes(32).toString("base64url")
}
