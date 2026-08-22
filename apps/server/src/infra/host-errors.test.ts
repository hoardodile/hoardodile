import {
	DomainError as HostDomainError,
	conflict as hostConflict,
	invalid as hostInvalid,
	notFound as hostNotFound,
} from "@hoardodile/host"
import {
	type DomainErrorCode,
	domainErrorCodes,
	isDomainError,
} from "@hoardodile/shared"
import { describe, expect, test } from "vitest"

/**
 * Bridge test for the host's DomainError mirror. The host deliberately
 * does not depend on `@hoardodile/shared`, so its errors are recognized
 * structurally — this suite pins that bridge so a drift between the two
 * taxonomies fails loudly instead of silently misclassifying host
 * errors in the HTTP/tRPC translation.
 */
describe("host domain error bridge", () => {
	test("host errors are structurally recognized by the server's isDomainError", () => {
		const err = hostConflict("server.read_only_archive", "blocked", {
			version: 1,
		})
		expect(err).toBeInstanceOf(HostDomainError)
		expect(isDomainError(err)).toBe(true)
		if (isDomainError(err)) {
			expect(err.kind).toBe("server.read_only_archive")
			expect(err.code).toBe("CONFLICT")
			expect(err.details).toEqual({ version: 1 })
		}
	})

	test("host error codes stay within the shared taxonomy", () => {
		const raised = [
			hostNotFound("x", "m").code,
			hostConflict("x", "m").code,
			hostInvalid("x", "m").code,
		]
		for (const code of raised) {
			expect(domainErrorCodes).toContain(code satisfies DomainErrorCode)
		}
	})

	test("host and shared messages/details survive the bridge verbatim", () => {
		const err = hostNotFound("resource.file_not_found", "no entry", {
			relPath: "a/b.png",
		})
		expect(err.message).toBe("no entry")
		expect((err as { details?: unknown }).details).toEqual({
			relPath: "a/b.png",
		})
	})
})
