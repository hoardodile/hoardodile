import { pluginAssetError } from "@hoardodile/sdk-types"
import type { ResourceAPI } from "./types.ts"

/**
 * The ResourceAPI handed to a plugin's `onInstall` hook: there is no
 * resource attached, so the file surface answers empty (or throws a
 * clear "no resource" error) and `context.detect` is `undefined`.
 *
 * The asset surface stays honest: in the app server the sandbox
 * intercepts these methods before the API object is consulted and
 * routes them to the consent-gated asset service with the owning
 * plugin id — the onInstall download flow is identical to the runtime
 * one. In-process hosts (fixtures, dev runner, CLI) answer
 * `UNAVAILABLE` exactly like every other host without a consent
 * channel.
 */
export function createInstallScopeApi(): ResourceAPI {
	const noResource = (method: string): Error =>
		new Error(
			`${method}() — no resource is attached to the onInstall hook; use the asset methods (download/statAsset/readAsset/deleteAsset) for install-time work`,
		)
	return {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: undefined },
		listFileNames: async () => [],
		readFile: async () => {
			throw noResource("readFile")
		},
		statFile: async () => undefined,
		statFiles: async (paths) => paths.map(() => undefined),
		sniff: async () => undefined,
		probe: async () => ({ kind: "unknown", reason: "unavailable" }),
		hashBytes: async () => {
			throw noResource("hashBytes")
		},
		computeImageHashes: async () => undefined,
		listContainer: async () => {
			throw noResource("listContainer")
		},
		extractArchive: async () => {
			throw noResource("extractArchive")
		},
		download: async () => {
			throw pluginAssetError(
				"UNAVAILABLE",
				"download() — this host has no plugin asset service; only the app server host can download into the plugin vault",
			)
		},
		statAsset: async () => {
			throw unavailableAsset("statAsset")
		},
		readAsset: async () => {
			throw unavailableAsset("readAsset")
		},
		deleteAsset: async () => {
			throw unavailableAsset("deleteAsset")
		},
	}
}

function unavailableAsset(method: string): Error {
	return pluginAssetError(
		"UNAVAILABLE",
		`${method}() — this host has no plugin asset vault; only the app server host manages vault files`,
	)
}
