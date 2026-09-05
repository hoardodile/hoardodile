import { createHash, timingSafeEqual } from "node:crypto"
import {
	type ClientRequest,
	request as httpRequest,
	type IncomingMessage,
	type OutgoingHttpHeaders,
} from "node:http"
import { Agent, type RequestOptions, request } from "node:https"
import { isIP } from "node:net"
import { type Duplex, Readable } from "node:stream"
import { connect, TLSSocket } from "node:tls"
import { BackupError } from "@hoardodile/backup"
import { HttpsProxyAgent } from "https-proxy-agent"

function normalizeFingerprint(value: string): string {
	const normalized = value.replaceAll(":", "").toLowerCase()
	if (!/^[a-f0-9]{64}$/.test(normalized))
		throw new BackupError(
			"invalid_fingerprint",
			"Enter a SHA-256 certificate fingerprint",
		)
	return normalized
}

function verifyPin(socket: TLSSocket, expected: string): void {
	const cert = socket.getPeerCertificate()
	if (!cert.raw)
		throw new BackupError(
			"certificate_missing",
			"The peer did not provide a certificate",
		)
	const actual = createHash("sha256").update(cert.raw).digest()
	if (
		!timingSafeEqual(actual, Buffer.from(normalizeFingerprint(expected), "hex"))
	) {
		throw new BackupError(
			"certificate_changed",
			"The peer certificate does not match the paired fingerprint",
		)
	}
}

/** Withhold the socket from HTTP until the peer's explicit certificate pin is verified. */
class PinnedAgent extends Agent {
	constructor(private readonly fingerprint: string) {
		super({ keepAlive: true })
	}
	override createConnection(
		options: RequestOptions,
		callback?: (error: Error | null, stream: Duplex) => void,
	) {
		const hostname = options.hostname ?? options.host ?? ""
		const socket = connect({
			host: hostname,
			port: Number(options.port ?? 443),
			servername: isIP(hostname) ? undefined : hostname,
			rejectUnauthorized: false,
		})
		let settled = false
		const finish = (error: Error | null) => {
			if (settled) return
			settled = true
			if (error) socket.destroy()
			callback?.(error, socket)
		}
		socket.once("error", finish)
		socket.once("secureConnect", () => {
			try {
				verifyPin(socket, this.fingerprint)
				finish(null)
			} catch (error) {
				finish(
					error instanceof Error
						? error
						: new Error("Certificate validation failed"),
				)
			}
		})
		return undefined
	}
}

class PinnedProxyAgent extends HttpsProxyAgent<string> {
	constructor(
		proxy: string,
		private readonly fingerprint: string,
	) {
		super(proxy, { keepAlive: true })
	}
	override async connect(
		req: ClientRequest,
		options: Parameters<HttpsProxyAgent<string>["connect"]>[1],
	) {
		const socket = await super.connect(req, {
			...options,
			secureEndpoint: true,
			rejectUnauthorized: false,
		})
		if (!(socket instanceof TLSSocket)) {
			socket.destroy()
			throw new Error("The proxy did not create a TLS connection")
		}
		await new Promise<void>((resolve, reject) => {
			socket.once("error", reject)
			socket.once("secureConnect", () => {
				try {
					verifyPin(socket, this.fingerprint)
					resolve()
				} catch (error) {
					socket.destroy()
					reject(error)
				}
			})
		})
		return socket
	}
}

export type PeerAddress = { url: string; fingerprint?: string }
export type PeerRequest = {
	method?: string
	headers?: OutgoingHttpHeaders
	body?: string | Readable
	signal?: AbortSignal
}

export function validatePeerAddress(input: PeerAddress): URL {
	const url = new URL(input.url)
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new BackupError(
			"invalid_peer",
			"Peer addresses must use HTTPS without credentials or query parameters",
		)
	}
	if (input.fingerprint) normalizeFingerprint(input.fingerprint)
	if (!url.pathname.endsWith("/")) url.pathname += "/"
	return url
}

export function createPeerClient(
	options: { proxyFor?: (url: URL) => string | undefined } = {},
) {
	const agents = new Map<string, Agent | HttpsProxyAgent<string>>()
	async function send(
		peer: PeerAddress,
		route: string,
		input: PeerRequest = {},
	): Promise<IncomingMessage> {
		const base = validatePeerAddress(peer)
		const url = new URL(route, base)
		if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
			throw new BackupError(
				"invalid_route",
				"The request escapes the paired service",
			)
		const proxy = options.proxyFor?.(url)
		const key = `${url.origin}|${peer.fingerprint ?? ""}|${proxy ?? ""}`
		let agent = agents.get(key)
		if (!agent) {
			agent = peer.fingerprint
				? proxy
					? new PinnedProxyAgent(proxy, peer.fingerprint)
					: new PinnedAgent(peer.fingerprint)
				: proxy
					? new HttpsProxyAgent(proxy, { keepAlive: true })
					: new Agent({ keepAlive: true })
			agents.set(key, agent)
		}
		return new Promise((resolve, reject) => {
			const req = request(
				url,
				{
					method: input.method ?? "GET",
					headers: cleanHeaders(input.headers),
					agent,
					signal: input.signal,
				},
				(response) => {
					if (
						(response.statusCode ?? 500) >= 300 &&
						(response.statusCode ?? 500) < 400
					) {
						response.resume()
						reject(
							new BackupError(
								"redirect_refused",
								"Paired service redirects are not allowed",
							),
						)
						return
					}
					resolve(response)
				},
			)
			req.setTimeout(120_000, () =>
				req.destroy(new Error("The peer connection timed out")),
			)
			req.on("error", reject)
			if (input.body instanceof Readable)
				input.body.on("error", (error) => req.destroy(error)).pipe(req)
			else req.end(input.body)
		})
	}
	return {
		send,
		async json(
			peer: PeerAddress,
			route: string,
			input: PeerRequest = {},
		): Promise<unknown> {
			const response = await send(peer, route, input)
			response.setEncoding("utf8")
			let data = ""
			for await (const chunk of response) {
				data += String(chunk)
				if (data.length > 16 * 1024 * 1024) {
					response.destroy()
					throw new BackupError(
						"response_limit",
						"The peer response was too large",
					)
				}
			}
			if ((response.statusCode ?? 500) >= 400)
				throw new BackupError(
					"peer_error",
					`The peer returned HTTP ${response.statusCode}`,
				)
			return JSON.parse(data)
		},
		close: () => {
			for (const agent of agents.values()) agent.destroy()
			agents.clear()
		},
	}
}

export async function loopbackRequest(
	url: URL,
	input: PeerRequest = {},
): Promise<IncomingMessage> {
	if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
		throw new Error("The internal transport must use loopback")
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			url,
			{
				method: input.method ?? "GET",
				headers: cleanHeaders(input.headers),
				signal: input.signal,
			},
			resolve,
		)
		req.on("error", reject)
		if (input.body instanceof Readable)
			input.body.on("error", (error) => req.destroy(error)).pipe(req)
		else req.end(input.body)
	})
}

function cleanHeaders(headers: OutgoingHttpHeaders = {}): OutgoingHttpHeaders {
	return Object.fromEntries(
		Object.entries(headers).filter(([, value]) => value !== undefined),
	)
}
