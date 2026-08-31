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

/**
 * What a stateless file token is bound to. `res` tokens authorize one
 * resource's file routes; `plugin` tokens authorize one plugin's asset
 * vault — a leaked token never exposes anything beyond its scope.
 */
export type TokenScope =
	| { readonly kind: "res"; readonly id: string }
	| { readonly kind: "plugin"; readonly id: string }

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
	/**
	 * Issue a 24 h stateless HMAC-signed token bound to one scope
	 * (a resource or a plugin).
	 */
	createToken(
		ttlSeconds: number,
		scope: TokenScope,
		now?: number,
	): Promise<FileToken>
	/**
	 * Verify a session token. Returns the session id and the scope the
	 * token is bound to if valid, otherwise `undefined`.
	 */
	verifyToken(
		sealed: string | undefined,
		now?: number,
	): Promise<
		{ readonly sessionId: string; readonly scope: TokenScope } | undefined
	>
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
 * Create a stateless HMAC-signed token bound to one scope. The token
 * embeds its own expiry and is self-authenticating — no server-side
 * storage needed.
 */
export function createToken(
	tokenKey: Buffer,
	ttlSeconds: number,
	scope: TokenScope,
	now: number = Date.now(),
): FileToken {
	const randomId = randomBytes(8).toString("base64url")
	const expiresAt = now + ttlSeconds * 1000
	const expiry = expiresAt.toString(36)
	const payload = `${randomId}.${expiry}.${scope.kind}.${scope.id}`
	const hmac = createHmac("sha256", tokenKey)
		.update(payload)
		.digest()
		.subarray(0, 16)
		.toString("base64url")
	return { sealed: `${payload}.${hmac}`, expiresAt }
}

/**
 * Verify an HMAC-signed token. Returns `{ sessionId: "ok", scope }` when
 * valid, or `undefined` when missing, expired, or tampered. The returned
 * scope is what the token is bound to — callers must compare it against
 * the resource/plugin the request actually targets.
 */
export function verifyToken(
	tokenKey: Buffer,
	sealed: string | undefined,
	now: number = Date.now(),
): { readonly sessionId: string; readonly scope: TokenScope } | undefined {
	if (sealed === undefined || sealed === "") return undefined
	const parts = sealed.split(".")
	if (parts.length !== 5) return undefined
	const [randomId, expiryStr, kind, id, sig] = parts as (string | undefined)[]
	if (
		randomId === undefined ||
		expiryStr === undefined ||
		id === undefined ||
		sig === undefined ||
		(kind !== "res" && kind !== "plugin")
	) {
		return undefined
	}
	const expiry = parseInt(expiryStr, 36)
	if (!Number.isFinite(expiry) || expiry <= now) return undefined
	const payload = `${randomId}.${expiryStr}.${kind}.${id}`
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
	return { sessionId: "ok", scope: { kind, id } }
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

	// In-memory reuse cache for stateless file tokens. A token is bound to a
	// single resource/plugin scope, so re-minting it on every call only
	// changes the URL (the embedded random nonce) — the web client then has
	// to re-download the resource content every open because the cache key
	// moved. Reusing the same token for its TTL keeps the content URL stable,
	// so the browser's HTTP cache (immutable, 1 y for resource files) can
	// serve it instead. This is a reuse cache, not a deny-list: tokens remain
	// stateless HMACs and their scope + expiry are still enforced on verify.
	const TOKEN_CACHE_MAX = 5_000
	const tokenCache = new Map<string, FileToken>()

	function tokenCacheKey(ttlSeconds: number, scope: TokenScope): string {
		return `${scope.kind}:${scope.id}:${ttlSeconds}`
	}

	async function issueToken(
		ttlSeconds: number,
		scope: TokenScope,
		now: number = Date.now(),
	): Promise<FileToken> {
		const key = tokenCacheKey(ttlSeconds, scope)
		const cached = tokenCache.get(key)
		if (cached !== undefined && cached.expiresAt > now) {
			return cached
		}
		const token = createToken(tokenKey, ttlSeconds, scope, now)
		tokenCache.set(key, token)
		if (tokenCache.size > TOKEN_CACHE_MAX) {
			for (const [cacheKey, entry] of tokenCache) {
				if (entry.expiresAt <= now) tokenCache.delete(cacheKey)
			}
			// Still over? Evict the oldest-cached entries (Map preserves
			// insertion order) rather than growing unbounded.
			while (tokenCache.size > TOKEN_CACHE_MAX) {
				const oldest = tokenCache.keys().next().value
				if (oldest === undefined) break
				tokenCache.delete(oldest)
			}
		}
		return token
	}

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
		createToken: (ttlSeconds, scope, now) => issueToken(ttlSeconds, scope, now),
		verifyToken: (sealed, now) =>
			Promise.resolve(verifyToken(tokenKey, sealed, now)),
	}
}

function newSessionId(): string {
	return randomBytes(32).toString("base64url")
}
