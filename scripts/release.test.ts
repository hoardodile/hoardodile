import { resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const commands = vi.hoisted(() => ({
	spawnSync: vi.fn(),
	execFileSync: vi.fn(),
	existsSync: vi.fn(),
}))

vi.mock("node:child_process", () => ({
	spawnSync: commands.spawnSync,
	execFileSync: commands.execFileSync,
}))
vi.mock("node:fs", () => ({ existsSync: commands.existsSync }))

const originalArgv = process.argv
const originalExitCode = process.exitCode
const root = resolve(import.meta.dirname, "..")

beforeEach(() => {
	vi.resetModules()
	commands.spawnSync.mockReset().mockReturnValue({ status: 0 })
	commands.execFileSync.mockReset().mockReturnValue("test-token\n")
	commands.existsSync.mockReset().mockReturnValue(true)
	vi.spyOn(console, "log").mockImplementation(() => {})
	vi.spyOn(console, "error").mockImplementation(() => {})
	vi.spyOn(console, "warn").mockImplementation(() => {})
	vi.spyOn(process, "exit").mockImplementation((code) => {
		throw new Error(`exit:${code}`)
	})
	vi.stubEnv("GITHUB_TOKEN", "test-token")
	process.argv = [process.execPath, resolve(root, "scripts", "release.mjs")]
	process.exitCode = undefined
})

afterEach(() => {
	process.argv = originalArgv
	process.exitCode = originalExitCode
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe("npm release checks", () => {
	const checks = [
		"version:check",
		"audit:release-set",
		"build",
		"sdks:pack",
		"licenses:check",
	]

	it("runs all publishing gates from the workspace root without publishing", async () => {
		await import("./check-release.mjs")

		expect(
			commands.spawnSync.mock.calls.map(([cmd, args]) => [cmd, args]),
		).toEqual(checks.map((check) => ["pnpm", [check]]))
		for (const [, , options] of commands.spawnSync.mock.calls) {
			expect(options.cwd).toBe(root)
			expect(options.shell).toBe(process.platform === "win32")
		}
		expect(process.exitCode).toBeUndefined()
	})

	it.each(checks)("stops immediately when %s fails", async (failedCheck) => {
		commands.spawnSync.mockImplementation((_cmd, args) => ({
			status: args[0] === failedCheck ? 1 : 0,
		}))

		await import("./check-release.mjs")

		expect(commands.spawnSync.mock.calls.map(([, args]) => args[0])).toEqual(
			checks.slice(0, checks.indexOf(failedCheck) + 1),
		)
		expect(process.exitCode).toBe(1)
	})
})

describe("release command", () => {
	it.each([
		{ status: 7 },
		{ status: null, signal: "SIGTERM" },
		{ status: null, error: new Error("pnpm not found") },
	])("never starts release-it when preflight fails: %j", async (result) => {
		vi.stubEnv("GITHUB_TOKEN", "")
		commands.spawnSync.mockReturnValueOnce(result)
		process.argv.push("0.3.0")

		await expect(import("./release.mjs")).rejects.toThrow(
			`exit:${result.status ?? 1}`,
		)

		expect(commands.spawnSync).toHaveBeenCalledExactlyOnceWith(
			"pnpm",
			["release:check"],
			expect.objectContaining({
				cwd: root,
				shell: process.platform === "win32",
			}),
		)
		expect(commands.execFileSync).not.toHaveBeenCalled()
	})

	it("checks before provisioning a token and forwards dry-run arguments unchanged", async () => {
		vi.stubEnv("GITHUB_TOKEN", "")
		process.argv.push("0.3.0", "--dry-run")

		await expect(import("./release.mjs")).rejects.toThrow("exit:0")

		expect(commands.spawnSync).toHaveBeenNthCalledWith(
			1,
			"pnpm",
			["release:check"],
			expect.objectContaining({ cwd: root }),
		)
		expect(commands.spawnSync).toHaveBeenNthCalledWith(
			2,
			process.execPath,
			[
				resolve(root, "node_modules", "release-it", "bin", "release-it.js"),
				"0.3.0",
				"--dry-run",
			],
			expect.objectContaining({ cwd: root }),
		)
		expect(commands.spawnSync.mock.invocationCallOrder[0]).toBeLessThan(
			commands.execFileSync.mock.invocationCallOrder[0],
		)
	})

	it.each(["--help", "-h", "--version", "-v"])(
		"forwards %s without checks or token lookup",
		async (arg) => {
			vi.stubEnv("GITHUB_TOKEN", "")
			process.argv.push(arg)

			await expect(import("./release.mjs")).rejects.toThrow("exit:0")

			expect(commands.spawnSync).toHaveBeenCalledTimes(1)
			expect(commands.spawnSync.mock.calls[0][0]).toBe(process.execPath)
			expect(commands.execFileSync).not.toHaveBeenCalled()
		},
	)
})
