import { isAuthReadPath } from "@hoardodile/shared"
import { type ComponentProps, useEffect, useState } from "react"
import { z } from "zod"
import { jsonFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"
import { canAccessContent, sessionGeneration, sessionMode } from "./session"

const tokenResponse = z.array(
	z.object({ path: z.string(), sealed: z.string(), expiresAt: z.number() }),
)
const cached = new Map<string, { sealed: string; expiresAt: number }>()
const pending = new Map<
	string,
	{ resolve: (value: string) => void; reject: (error: unknown) => void }[]
>()
let scheduled = false
let cacheGeneration = -1

async function flushTokens(): Promise<void> {
	scheduled = false
	const batch = new Map(pending)
	pending.clear()
	const generation = sessionGeneration()
	const paths = [...batch.keys()]
	for (let offset = 0; offset < paths.length; offset += 100) {
		const chunk = paths.slice(offset, offset + 100)
		try {
			const entries = tokenResponse.parse(
				await jsonFetch(apiPaths.auth.readTokens(), {
					method: "POST",
					body: JSON.stringify({ paths: chunk }),
				}),
			)
			if (generation !== sessionGeneration() || !canAccessContent())
				throw new Error("locked")
			for (const entry of entries) {
				cached.set(entry.path, entry)
				for (const waiter of batch.get(entry.path) ?? [])
					waiter.resolve(entry.sealed)
			}
		} catch (error) {
			for (const path of chunk)
				for (const waiter of batch.get(path) ?? []) waiter.reject(error)
		}
	}
}

/** A native URL carries only a GET/HEAD capability for this exact resource path. */
export async function authenticatedReadUrl(href: string): Promise<string> {
	if (
		sessionMode() !== "page" ||
		!href.startsWith("/api/") ||
		!isAuthReadPath(new URL(href, window.location.origin).pathname)
	)
		return href
	if (!canAccessContent()) throw new Error("locked")
	const url = new URL(href, window.location.origin)
	if (url.searchParams.has("readToken")) return href
	if (cacheGeneration !== sessionGeneration()) {
		cached.clear()
		cacheGeneration = sessionGeneration()
	}
	const entry = cached.get(url.pathname)
	const sealed =
		entry && entry.expiresAt > Date.now() + 60_000
			? entry.sealed
			: await new Promise<string>((resolve, reject) => {
					const waiters = pending.get(url.pathname) ?? []
					waiters.push({ resolve, reject })
					pending.set(url.pathname, waiters)
					if (!scheduled) {
						scheduled = true
						queueMicrotask(() => {
							void flushTokens()
						})
					}
				})
	url.searchParams.set("readToken", sealed)
	return url.pathname + url.search + url.hash
}

export function useAuthenticatedReadUrl(
	href: string | undefined,
): string | undefined {
	const protectedUrl = sessionMode() === "page" && href?.startsWith("/api/")
	const [resolved, setResolved] = useState<{ href: string; url: string }>()
	useEffect(() => {
		if (!protectedUrl || href === undefined) return
		let cancelled = false
		void authenticatedReadUrl(href)
			.then((url) => {
				if (!cancelled) setResolved({ href, url })
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	}, [href, protectedUrl])
	return protectedUrl
		? resolved && resolved.href === href
			? resolved.url
			: undefined
		: href
}

export function AuthImage({ src, alt = "", ...props }: ComponentProps<"img">) {
	return (
		<img
			{...props}
			alt={alt}
			src={useAuthenticatedReadUrl(src)}
			referrerPolicy="no-referrer"
		/>
	)
}

export function AuthVideo({ src, ...props }: ComponentProps<"video">) {
	return <video {...props} src={useAuthenticatedReadUrl(src)} />
}

export function AuthAudio({ src, ...props }: ComponentProps<"audio">) {
	return <audio {...props} src={useAuthenticatedReadUrl(src)} />
}

export function AuthDownload({ href, ...props }: ComponentProps<"a">) {
	return (
		<a
			{...props}
			href={useAuthenticatedReadUrl(href)}
			referrerPolicy="no-referrer"
		/>
	)
}
