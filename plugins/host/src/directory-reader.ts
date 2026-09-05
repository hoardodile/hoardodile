import { constants, type Stats } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import { isAbsolute, normalize, relative, resolve, sep } from "node:path"

export function isMissingEntry(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	)
}

function unsafePath(): Error {
	return new Error(
		"Resource path is unsafe: links, special files, and paths outside the resource directory are not allowed",
	)
}

function within(root: string, path: string): string {
	const rel = relative(root, path)
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
		throw unsafePath()
	return rel
}

function ordinary(info: Stats): void {
	if (
		info.isSymbolicLink() ||
		(!info.isDirectory() && !info.isFile()) ||
		(info.isFile() && info.nlink > 1)
	)
		throw unsafePath()
}

/** Lexical validation only; disk reads must also go through the directory reader. */
export function resolveSafeImportPath(dir: string, relPath: string): string {
	if (relPath.length === 0) throw new Error("path is empty")
	if (relPath.includes("\0")) throw new Error("path contains null byte")
	if (isAbsolute(relPath)) throw new Error("absolute paths are not allowed")
	const normalized = normalize(relPath)
	if (normalized.startsWith(".."))
		throw new Error("path escapes import directory")
	const root = resolve(dir)
	const candidate = resolve(root, normalized)
	if (candidate !== root && !candidate.startsWith(root + sep))
		throw new Error("path escapes import directory")
	return candidate
}

/**
 * Pin the trusted root and reject links below it on every access. A supplied
 * storage root permits filesystem aliases above that boundary (such as /tmp
 * on macOS), while still checking the entire path down to a resource's data.
 */
export function createDirectoryReader(dir: string, boundaryRoot?: string) {
	const root = resolve(dir)
	const boundary = resolve(boundaryRoot ?? dir)
	const rootRel = within(boundary, root)
	let anchor: Promise<{ path: string; info: Stats }> | undefined
	async function trustedRoot() {
		if (boundaryRoot === undefined) ordinary(await lstat(boundary))
		anchor ??= (async () => {
			const path = await realpath(boundary)
			const info = await lstat(path)
			ordinary(info)
			if (!info.isDirectory()) throw unsafePath()
			return { path, info }
		})().catch((error) => {
			anchor = undefined
			throw error
		})
		const saved = await anchor
		const actual = await realpath(boundary)
		const info = await lstat(actual)
		ordinary(info)
		if (
			actual !== saved.path ||
			info.dev !== saved.info.dev ||
			info.ino !== saved.info.ino
		)
			throw unsafePath()
		return saved
	}
	async function entry(relPath: string, directory = false) {
		const candidate =
			directory && relPath === "" ? root : resolveSafeImportPath(root, relPath)
		const saved = await trustedRoot()
		let path = saved.path
		let info = saved.info
		for (const part of within(boundary, candidate).split(sep).filter(Boolean)) {
			path = resolve(path, part)
			info = await lstat(path)
			ordinary(info)
		}
		const actual = await realpath(path)
		within(resolve(saved.path, rootRel), actual)
		if (relative(path, actual) !== "") throw unsafePath()
		if (directory ? !info.isDirectory() : !info.isFile()) throw unsafePath()
		return { path: actual, info }
	}
	async function openFile(relPath: string) {
		const before = await entry(relPath)
		const flags =
			constants.O_RDONLY |
			(constants.O_NOFOLLOW ?? 0) |
			(constants.O_NONBLOCK ?? 0)
		const handle = await open(before.path, flags)
		try {
			const info = await handle.stat()
			ordinary(info)
			const after = await entry(relPath)
			if (
				!info.isFile() ||
				info.dev !== after.info.dev ||
				info.ino !== after.info.ino ||
				before.path !== after.path
			)
				throw unsafePath()
			return { handle, info, path: after.path }
		} catch (error) {
			await handle.close()
			throw error
		}
	}
	return { entry, openFile }
}
