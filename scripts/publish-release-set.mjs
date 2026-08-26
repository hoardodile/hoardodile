#!/usr/bin/env node
/**
 * Publish every release-set package whose version is missing from npm.
 *
 * Wired into release.yml's npm job in place of `pnpm -r publish`: a tag
 * push publishes all new versions, but a `workflow_dispatch` re-run of an
 * already-released version (introduced to complete a release whose tag
 * predates a pipeline fix) must not fail with "version already exists" —
 * it only needs to fix the legs that failed the first time.
 *
 * Trusted publishing (OIDC) still applies per package: each publish
 * requests the id-token and attaches provenance attestations.
 *
 * pnpm's publish git checks are deliberately disabled (git-checks=false):
 * the npm job runs on a tag-push checkout, which is a detached HEAD —
 * pnpm's default publish-branch check (`master|main`) refuses that with
 * ERR_PNPM_GIT_UNKNOWN_BRANCH, so every tag release would fail at the
 * first package. The CI tree is a fresh tag checkout, so the dirty-tree
 * half of the check cannot trigger either; reportWorkingTree() below
 * still prints any drift so a failure is diagnosable at a glance.
 *
 * A failed publish is retried once only when the failure is transient
 * (npm CDN replica lag — the reason the original retry exists);
 * deterministic failures fail fast with the captured output instead of
 * pausing 60 s to fail identically.
 *
 *   node scripts/publish-release-set.mjs
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"
import { PUBLISHED_PACKAGE_MANIFESTS } from "./lib/release-packages.mjs"

// The npm view read hits the same CDN the writes do; a replica lag just
// after a very recent publish could double-publish a version. npm rejects
// the duplicate PUT, so retry once after a pause before giving up.
const RETRY_DELAY_MS = 60_000

/** Lines of npm's own publish log worth echoing; the rest is boilerplate. */
const SUCCESS_LOG_LINES = 12

/**
 * Signals that a publish failure is worth retrying: network errors and
 * npm returning a broken-pipe-style response. Everything else (a bad
 * manifest, a rejected package, the git check) is deterministic —
 * retrying it only adds the delay above before failing identically.
 */
function isTransientPublishError(error) {
	const description = `${error.code ?? ""} ${error.stderr ?? ""} ${error.stdout ?? ""}`
	return [
		"EAI_AGAIN",
		"ECONNRESET",
		"ECONNREFUSED",
		"ETIMEDOUT",
		"ENOTFOUND",
		"EPIPE",
		"socket hang up",
	].some((signal) => description.includes(signal))
}

function publishArgs(packageName) {
	return [
		"publish",
		"--filter",
		packageName,
		"--config.provenance=true",
		"--config.git-checks=false",
	]
}

function publish(packageName) {
	try {
		const { stdout } = execFileSync("pnpm", publishArgs(packageName), {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		})
		const tail = stdout.trimEnd().split("\n").slice(-SUCCESS_LOG_LINES)
		if (tail.length > 0) console.log(tail.join("\n"))
	} catch (error) {
		// execFileSync gives `error.stdout`/`error.stderr` as strings when
		// stdio is piped; the default (inherited) version carries neither,
		// which made past failures print an empty "output: [null,null,null]".
		const detail = [error.code, error.stderr, error.stdout]
			.filter((part) => typeof part === "string" && part.length > 0)
			.join("\n")
			.trim()
		throw new Error(
			`pnpm publish ${packageName} failed${
				detail.length > 0 ? `:\n${detail}` : ""
			}`,
			{ cause: error },
		)
	}
}

async function publishWithRetry(packageName) {
	let lastError
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			publish(packageName)
			return
		} catch (error) {
			// The cause is the raw execFileSync error whose code/stderr
			// carry the network signals; the wrapper carries the summary.
			lastError = error
			if (!isTransientPublishError(error.cause)) break
			console.log(`retrying ${packageName} after ${RETRY_DELAY_MS}ms...`)
			await sleep(RETRY_DELAY_MS)
		}
	}
	// Duplicate-PUT race (also cover a lost publish response): the
	// pre-publish `npm view` read a lagging replica or the first attempt
	// actually landed — the registry is the truth. Re-read it instead of
	// failing on a version that is published; a dispatch re-run then stays
	// idempotent.
	if (publishedVersion(packageName) !== undefined) {
		console.log(`skipping ${packageName} (published concurrently)`)
		return
	}
	throw lastError
}

function reportWorkingTree() {
	// git-checks are off (see the header), so this is the only place a
	// dirty tree would surface before a publish; print it so a failing
	// run is diagnosable at a glance.
	try {
		const status = execFileSync("git", ["status", "--porcelain"], {
			encoding: "utf8",
		})
		if (status.trim() !== "") {
			console.log("working tree is dirty before publish:")
			process.stdout.write(status)
		}
	} catch {
		// git unavailable — harmless, there is nothing to report then
	}
}

function publishedVersion(packageName) {
	try {
		return execFileSync("npm", ["view", packageName, "version"], {
			encoding: "utf8",
		}).trim()
	} catch {
		return undefined
	}
}

async function main() {
	reportWorkingTree()
	let published = 0
	let skipped = 0
	for (const manifestPath of PUBLISHED_PACKAGE_MANIFESTS) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		const { name, version } = manifest
		if (publishedVersion(name) === version) {
			console.log(`skipping ${name}@${version} (already on npm)`)
			skipped += 1
			continue
		}
		await publishWithRetry(name)
		published += 1
		console.log(`published ${name}@${version}`)
	}
	console.log(`publish set done: ${published} published, ${skipped} skipped`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
