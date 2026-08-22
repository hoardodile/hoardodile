import { spawn } from "node:child_process"
import { EXIT_ERROR } from "./runner.ts"

export type CreateOptions = {
	readonly name?: string
	readonly tarballs?: string
}

/**
 * `hoardodile plugin create` — facade over the published scaffolder.
 * `create-hoardodile-plugin` stays its own package (npm's `create-*`
 * convention), so this runs it via `pnpm dlx` and forwards the args.
 */
export function resolveCreateArgs(opts: CreateOptions): string[] {
	const args = ["dlx", "--yes", "create-hoardodile-plugin"]
	if (opts.name !== undefined) args.push(opts.name)
	if (opts.tarballs !== undefined) args.push("--tarballs", opts.tarballs)
	return args
}

export async function executeCreate(opts: CreateOptions): Promise<number> {
	return new Promise((resolveExit) => {
		const child = spawn("pnpm", resolveCreateArgs(opts), {
			stdio: "inherit",
			shell: process.platform === "win32",
		})
		child.on("error", (err) => {
			console.error(
				`[hoardodile] failed to start create-hoardodile-plugin: ${err.message}`,
			)
			resolveExit(EXIT_ERROR)
		})
		child.on("exit", (code) => {
			resolveExit(code ?? EXIT_ERROR)
		})
	})
}
