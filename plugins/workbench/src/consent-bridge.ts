import type {
	DownloadConsentEntry,
	PluginAssetVaultMock,
} from "@hoardodile/host-web"
import {
	getDownloadConsentSnapshot,
	requestDownloadConsent,
	subscribeDownloadConsent,
} from "@hoardodile/host-web"
import type { PluginDownloadRequest } from "@hoardodile/sdk-types"
import { useSyncExternalStore } from "react"
import type { WorkbenchManifest } from "./context.ts"

/**
 * The workbench's asset-vault integration: the same consent store and
 * dialog the app uses, with the dev server doing the actual fetch (the
 * browser has CORS; the server does not).
 *
 * Flow: cache pre-check → (miss) consent dialog → approved → dev-server
 * download into `<vaultRoot>/<pluginId>/<dest>` → result. Denials answer
 * `DENIED`; manifest without `download` answers `POLICY` — the same
 * vocabulary as the app.
 */

/** The currently queued consent ticket, or null (one dialog at a time). */
export function useDownloadConsentEntry(): DownloadConsentEntry | null {
	const { queue } = useSyncExternalStore(
		subscribeDownloadConsent,
		getDownloadConsentSnapshot,
		getDownloadConsentSnapshot,
	)
	return queue[0] ?? null
}

export function createAssetVault(
	manifest: WorkbenchManifest,
): PluginAssetVaultMock {
	return {
		async download(request) {
			if (manifest.permissions?.download !== true) {
				throw assetError(
					"POLICY",
					'download permission denied — declare "download": true in the manifest',
				)
			}
			const pluginId = manifest.id
			const precheck = await requestDownload(pluginId, request, false)
			if (precheck.status === "cached") {
				return {
					path: precheck.path,
					sizeBytes: precheck.sizeBytes,
					sha256: precheck.sha256,
					cached: true,
				}
			}
			const approved = await requestDownloadConsent({
				ticketId: crypto.randomUUID(),
				pluginId,
				pluginName: manifest.name,
				url: request.url,
				dest: request.dest,
				reason: request.reason,
			})
			if (!approved) {
				throw assetError("DENIED", "plugin download was declined")
			}
			const done = await requestDownload(pluginId, request, true)
			if (done.status !== "downloaded") {
				throw assetError("POLICY", "workbench vault download did not finish")
			}
			return {
				path: done.path,
				sizeBytes: done.sizeBytes,
				sha256: done.sha256,
				cached: false,
			}
		},
		async deleteAsset(path) {
			const res = await fetch("/api/workbench/vault/delete", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ pluginId: manifest.id, path }),
			})
			const body = await expectJson<{ existed: boolean }>(res)
			return body
		},
	}
}

type VaultDownloadOutcome =
	| {
			readonly status: "cached"
			readonly path: string
			readonly sizeBytes: number
			readonly sha256: string
	  }
	| { readonly status: "missing" }
	| {
			readonly status: "downloaded"
			readonly path: string
			readonly sizeBytes: number
			readonly sha256: string
	  }

async function requestDownload(
	pluginId: string,
	request: PluginDownloadRequest,
	force: boolean,
): Promise<VaultDownloadOutcome> {
	const res = await fetch(
		`/api/workbench/vault/download${force ? "?force=1" : ""}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				pluginId,
				url: request.url,
				dest: request.dest,
				sha256: request.sha256,
			}),
		},
	)
	return expectJson<VaultDownloadOutcome>(res)
}

async function expectJson<T>(res: Response): Promise<T> {
	if (!res.ok) {
		const text = await res.text().catch(() => "")
		throw assetError(
			"POLICY",
			`workbench vault request failed (HTTP ${res.status})${text ? `: ${text}` : ""}`,
		)
	}
	return (await res.json()) as T
}

function assetError(
	code: "DENIED" | "UNAVAILABLE" | "POLICY",
	message: string,
): Error {
	const err = new Error(message)
	err.name = code
	return err
}

export type { WorkbenchManifest }
