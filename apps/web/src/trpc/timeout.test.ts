/**
 * @vitest-environment node
 */

import { LONG_RUNNING_TRPC_PROCEDURES } from "@hoardodile/shared/trpc-timeouts"
import { describe, expect, it } from "vitest"
import {
	LONG_RUNNING_TRPC_TIMEOUT_MS,
	TRPC_TIMEOUT_MS,
	trpcTimeoutMs,
} from "./timeout"

describe("trpcTimeoutMs", () => {
	it("keeps the default cap for ordinary procedures", () => {
		expect(
			trpcTimeoutMs("http://127.0.0.1:5175/trpc/resource.listCards?batch=1"),
		).toBe(TRPC_TIMEOUT_MS)
		expect(
			trpcTimeoutMs("http://127.0.0.1:5175/trpc/pluginAsset.decide?batch=1"),
		).toBe(TRPC_TIMEOUT_MS)
		expect(
			trpcTimeoutMs(
				"http://127.0.0.1:5175/trpc/pluginAsset.listPending?batch=1",
			),
		).toBe(TRPC_TIMEOUT_MS)
	})

	it("grants the SDK download ceiling to pluginAsset.request", () => {
		expect(
			trpcTimeoutMs("http://127.0.0.1:5175/trpc/pluginAsset.request?batch=1"),
		).toBe(LONG_RUNNING_TRPC_TIMEOUT_MS)
		expect(
			trpcTimeoutMs("http://127.0.0.1:5175/trpc/pluginAsset.request"),
		).toBe(LONG_RUNNING_TRPC_TIMEOUT_MS)
	})

	it("grants the same ceiling to resource.extractArchive", () => {
		expect(
			trpcTimeoutMs(
				"http://127.0.0.1:5175/trpc/resource.extractArchive?batch=1",
			),
		).toBe(LONG_RUNNING_TRPC_TIMEOUT_MS)
	})

	it("accepts URL and Request inputs", () => {
		expect(
			trpcTimeoutMs(new URL("http://127.0.0.1:5175/trpc/pluginAsset.request")),
		).toBe(LONG_RUNNING_TRPC_TIMEOUT_MS)
		expect(
			trpcTimeoutMs(
				new Request("http://127.0.0.1:5175/trpc/pluginAsset.request"),
			),
		).toBe(LONG_RUNNING_TRPC_TIMEOUT_MS)
	})

	it("a prefixed path-suffix can never match a different procedure", () => {
		expect(
			trpcTimeoutMs("http://127.0.0.1:5175/trpc/notpluginAsset.request"),
		).toBe(TRPC_TIMEOUT_MS)
	})

	it("still covers every procedure the shared table declares", () => {
		for (const procedure of LONG_RUNNING_TRPC_PROCEDURES) {
			expect(trpcTimeoutMs(`http://127.0.0.1:5175/trpc/${procedure}`)).toBe(
				LONG_RUNNING_TRPC_TIMEOUT_MS,
			)
		}
	})

	it("a batched URL keeps the ceiling when it carries a long-running procedure", () => {
		expect(
			trpcTimeoutMs(
				"http://127.0.0.1:5175/trpc/pluginAsset.request,pluginAsset.decide?batch=1",
			),
		).toBe(LONG_RUNNING_TRPC_TIMEOUT_MS)
		expect(
			trpcTimeoutMs(
				"http://127.0.0.1:5175/trpc/pluginAsset.decide,pluginAsset.request?batch=1",
			),
		).toBe(LONG_RUNNING_TRPC_TIMEOUT_MS)
		expect(
			trpcTimeoutMs(
				"http://127.0.0.1:5175/trpc/resource.listCards,pluginAsset.listPending?batch=1",
			),
		).toBe(TRPC_TIMEOUT_MS)
	})
})
