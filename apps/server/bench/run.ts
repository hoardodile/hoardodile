/**
 * Process entry for the bench CLI — keeps `cli.ts` importable (and the
 * dispatcher unit-testable) by confining the top-level await + exit code
 * handling to this one-shot module.
 */
import { runCli } from "./cli.ts"

try {
	await runCli(process.argv.slice(2))
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 2
}
