import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { FastifyReply } from "fastify"

export type Validators = {
	readonly etag: string
	readonly lastModified: string
}

export function computeValidators(info: {
	size: number
	mtimeMs: number
}): Validators {
	const mtime = Math.floor(info.mtimeMs)
	return {
		etag: `W/"${info.size.toString(16)}-${mtime.toString(16)}"`,
		lastModified: new Date(mtime).toUTCString(),
	}
}

export function isNotModified(
	headers: Readonly<Record<string, string | string[] | undefined>>,
	validators: Validators,
): boolean {
	const ifNoneMatch = pickHeader(headers["if-none-match"])
	if (ifNoneMatch !== undefined) {
		return ifNoneMatch
			.split(",")
			.map((s) => s.trim())
			.some((tag) => tag === validators.etag || tag === "*")
	}
	const ifModifiedSince = pickHeader(headers["if-modified-since"])
	if (ifModifiedSince !== undefined) {
		const since = Date.parse(ifModifiedSince)
		const last = Date.parse(validators.lastModified)
		return Number.isFinite(since) && Number.isFinite(last) && last <= since
	}
	return false
}

export function pickHeader(
	value: string | string[] | undefined,
): string | undefined {
	if (Array.isArray(value)) return value[0]
	return value
}

export function replyNotModified(
	reply: FastifyReply,
	headers: Readonly<Record<string, string | string[] | undefined>>,
	info: { size: number; mtimeMs: number },
): boolean {
	const validators = computeValidators(info)
	reply.header("etag", validators.etag)
	reply.header("last-modified", validators.lastModified)
	if (isNotModified(headers, validators)) {
		reply.code(304)
		reply.send()
		return true
	}
	return false
}

export async function sendFile(
	reply: FastifyReply,
	path: string,
	opts: {
		contentType: string
		cacheControl: string
		conditional?: {
			headers: Readonly<Record<string, string | string[] | undefined>>
		}
	},
): Promise<FastifyReply> {
	const info = await stat(path)
	if (opts.conditional) {
		if (replyNotModified(reply, opts.conditional.headers, info)) return reply
	}
	reply.header("content-type", opts.contentType)
	reply.header("content-length", String(info.size))
	reply.header("cache-control", opts.cacheControl)
	return reply.send(createReadStream(path))
}
