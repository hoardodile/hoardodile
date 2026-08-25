#!/usr/bin/env node

/**
 * Generate `src/routeTree.gen.ts` outside the vite plugin so every consumer
 * of the route tree works on a fresh checkout — the file is a source input
 * (`src/main.tsx`, the test router, the tsc run) but the plugin only runs
 * inside `vite build`/`vite dev`, which turbo cache hits skip entirely.
 *
 * Wired first in the `build`/`lint`/`test` script chain (milliseconds), so
 * the file is regenerated deterministically with the same generator and
 * config the vite plugin uses — @tanstack/router-generator is pinned to the
 * exact version the plugin bundles. The file itself is gitignored.
 *
 *   node scripts/gen-route-tree.mjs
 */

import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Generator, getConfig } from "@tanstack/router-generator"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// Keep in lockstep with the tanstackRouter() options in vite.config.ts.
const generator = new Generator({
	config: getConfig(
		{
			target: "react",
			autoCodeSplitting: false,
			routesDirectory: "./src/routes",
			generatedRouteTree: "./src/routeTree.gen.ts",
			routeFileIgnorePattern: "\\.test\\.(ts|tsx)$",
		},
		ROOT,
	),
	root: ROOT,
})

await generator.run()
console.log("[web] route tree generated (src/routeTree.gen.ts)")
