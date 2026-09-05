import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import {
	lstat,
	mkdir,
	open,
	readdir,
	realpath,
	rename,
	rm,
} from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { BackupError, safeRelativePath } from "./types.ts"

export async function atomicWrite(
	path: string,
	content: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	const temporary = `${path}.${randomUUID()}.tmp`
	try {
		const handle = await open(temporary, "wx", 0o600)
		try {
			await handle.writeFile(content, "utf8")
			await handle.sync()
		} finally {
			await handle.close()
		}
		await rename(temporary, path)
	} finally {
		await rm(temporary, { force: true })
	}
}

export function confinedPath(root: string, name: string): string {
	safeRelativePath.parse(name)
	const target = resolve(root, ...name.split("/"))
	const rel = relative(resolve(root), target)
	if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
		throw new BackupError(
			"unsafe_path",
			"The path escapes the managed directory",
		)
	}
	return target
}

export async function assertNoLinks(
	root: string,
	target = root,
): Promise<void> {
	const absoluteRoot = resolve(root)
	const absoluteTarget = resolve(target)
	const rel = relative(absoluteRoot, absoluteTarget)
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
		throw new BackupError(
			"unsafe_path",
			"The path escapes the managed directory",
		)
	}
	let current = absoluteRoot
	for (const part of ["", ...rel.split(sep).filter(Boolean)]) {
		if (part) current = join(current, part)
		try {
			const info = await lstat(current)
			if (
				info.isSymbolicLink() ||
				(!info.isDirectory() && !info.isFile()) ||
				(info.isFile() && info.nlink > 1)
			) {
				throw new BackupError(
					"unsafe_path",
					"Links and special files are not supported",
				)
			}
		} catch (error) {
			if (isMissing(error)) return
			throw error
		}
	}
	const realRoot = await realpath(absoluteRoot)
	const actual = await realpath(absoluteTarget)
	const actualRelative = relative(realRoot, actual)
	if (
		isAbsolute(actualRelative) ||
		actualRelative === ".." ||
		actualRelative.startsWith(`..${sep}`)
	) {
		throw new BackupError(
			"unsafe_path",
			"The resolved path escapes the managed directory",
		)
	}
}

export function isMissing(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256")
	for await (const chunk of createReadStream(path)) hash.update(chunk)
	return hash.digest("hex")
}

export async function* walkFiles(root: string): AsyncGenerator<string> {
	await assertNoLinks(root)
	const stack = [root]
	while (stack.length) {
		const dir = stack.pop()!
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name)
			if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
				throw new BackupError(
					"unsafe_path",
					"Links and special files are not supported",
				)
			}
			if (entry.isDirectory()) stack.push(path)
			else {
				if ((await lstat(path)).nlink > 1)
					throw new BackupError(
						"unsafe_path",
						"Hard-linked files are not supported in managed data",
					)
				yield relative(root, path).split(sep).join("/")
			}
		}
	}
}
