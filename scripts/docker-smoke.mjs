#!/usr/bin/env node
/**
 * Automated Docker verification — the answer to "is the image actually
 * shippable": build through compose.yaml (so the shipped compose file is
 * what gets exercised), boot a throwaway stack, and assert the boot
 * contract:
 *
 *   1. /health answers { ok: true } within a generous deadline (the
 *      sidecar booted: natives, migrations, plugin channels);
 *   2. / serves the SPA — the embedded apps/web/dist tree;
 *   3. migrations landed in the volume (/data/app.sqlite exists);
 *   4. the same volume survives a `down`/`up` cycle (persistence).
 *
 * Usage:
 *   node scripts/docker-smoke.mjs [--skip-build]
 *
 * The full UI claim flow is covered separately: on release tags the web
 * e2e suite runs against the same stack via E2E_EXTERNAL_BASE_URL.
 */

import { execFileSync, spawnSync } from "node:child_process"

const PROJECT = "hd-smoke"
const PORT = Number(
	process.env.HOARDODILE_SMOKE_PORT ?? String(39000 + (process.pid % 1000)),
)
const BASE_URL = `http://127.0.0.1:${PORT}`
const HEALTH_TIMEOUT_MS = 180_000
const HEALTH_POLL_MS = 1_000

const skipBuild = process.argv.includes("--skip-build")

function compose(args, options = {}) {
	return execFileSync(
		"docker",
		["compose", "--project-name", PROJECT, ...args],
		{
			stdio: options.pipeStdio ? "pipe" : "inherit",
			env: { ...process.env, HOARDODILE_PORT: String(PORT) },
			timeout: 900_000,
		},
	)
}

function composeCheck(args) {
	const res = spawnSync(
		"docker",
		["compose", "--project-name", PROJECT, ...args],
		{
			stdio: "ignore",
			env: { ...process.env, HOARDODILE_PORT: String(PORT) },
			timeout: 120_000,
		},
	)
	return res.status === 0
}

function fail(message) {
	console.error(`[docker-smoke] ${message}`)
	process.exit(1)
}

async function waitForHealth() {
	const deadline = Date.now() + HEALTH_TIMEOUT_MS
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${BASE_URL}/health`)
			if (res.ok) {
				const body = await res.json()
				if (typeof body === "object" && body !== null && body.ok === true) {
					return
				}
			}
		} catch {
			// container still booting
		}
		await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS))
	}
	fail(`/health was not ok within ${HEALTH_TIMEOUT_MS / 1000}s at ${BASE_URL}`)
}

async function main() {
	try {
		if (skipBuild) {
			console.log("[docker-smoke] skipping build (--skip-build)")
		} else {
			console.log("[docker-smoke] building image…")
			compose(["build"])
		}

		console.log("[docker-smoke] booting stack…")
		compose(["up", "-d"])
		await waitForHealth()
		console.log("[docker-smoke] /health ok")

		const index = await fetch(`${BASE_URL}/`)
		if (!index.ok) {
			fail(`GET / returned ${String(index.status)}`)
		}
		const html = await index.text()
		if (!html.includes('id="root"')) {
			fail('GET / did not serve the SPA document (no <div id="root">)')
		}
		console.log("[docker-smoke] SPA served at /")

		if (
			!composeCheck([
				"exec",
				"-T",
				"hoardodile",
				"test",
				"-f",
				"/data/app.sqlite",
			])
		) {
			fail("migrations did not land: /data/app.sqlite missing in the container")
		}
		console.log("[docker-smoke] migrations landed in /data/app.sqlite")

		console.log("[docker-smoke] persistence cycle (down → up, same volume)…")
		compose(["down"])
		compose(["up", "-d"])
		await waitForHealth()
		if (
			!composeCheck([
				"exec",
				"-T",
				"hoardodile",
				"test",
				"-f",
				"/data/app.sqlite",
			])
		) {
			fail("library did not survive the restart cycle")
		}
		console.log("[docker-smoke] volume persistence ok")

		console.log("[docker-smoke] PASS")
	} finally {
		console.log("[docker-smoke] cleaning up…")
		compose(["down", "-v", "--remove-orphans"])
	}
}

main().catch((err) => {
	console.error("[docker-smoke]", err)
	process.exit(1)
})
