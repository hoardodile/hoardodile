import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { ProxyResolver } from "@hoardodile/shared/net-proxy"
import type { PluginDownloader } from "src/domain/plugin/downloader.ts"

export type OutboundNetworkInfo = {
	readonly source: "explicit" | "env" | "system" | "none"
	readonly httpHost: string | null
	readonly httpsHost: string | null
	readonly bypassCount: number
}

export type OutboundNetworkTestResult =
	| { readonly ok: true; readonly status: number }
	| { readonly ok: false; readonly message: string }

export type OutboundNetwork = {
	/** Read-only view of the resolved app-wide proxy config. */
	readonly info: () => OutboundNetworkInfo
	/**
	 * Connectivity probe through the exact path the marketplace uses:
	 * the raw.githubusercontent.com host (the one that breaks in
	 * DNS-blocked / proxy-only environments). Any HTTP answer (including
	 * a 404 — the registry may simply not be published yet) counts as
	 * reachable; DNS, policy and proxy failures surface their message.
	 */
	readonly test: () => Promise<OutboundNetworkTestResult>
}

const PROBE_MAX_BYTES = 64 * 1024
const PROBE_URL =
	"https://raw.githubusercontent.com/hoardodile/marketplace/HEAD/registry.json"

export function createOutboundNetwork(deps: {
	readonly config: ProxyResolver
	readonly fetcher: PluginDownloader
	readonly tmpDir: string
}): OutboundNetwork {
	function info(): OutboundNetworkInfo {
		const config = deps.config()
		return {
			source: config.source,
			httpHost: config.http?.host ?? null,
			httpsHost: config.https?.host ?? null,
			bypassCount: config.bypass.length,
		}
	}

	async function test(): Promise<OutboundNetworkTestResult> {
		const target = join(deps.tmpDir, `network-probe-${randomUUID()}.tmp`)
		try {
			await mkdir(deps.tmpDir, { recursive: true })
			await deps.fetcher.fetchToFile(PROBE_URL, target, {
				maxBytes: PROBE_MAX_BYTES,
			})
			return { ok: true, status: 200 }
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			const statusMatch = /HTTP (\d{3})/.exec(message)
			if (statusMatch !== null) {
				// The host answered — reachable (a 404 just means the
				// registry is not published yet).
				return { ok: true, status: Number(statusMatch[1]) }
			}
			return { ok: false, message }
		} finally {
			await rm(target, { force: true }).catch(() => {})
		}
	}

	return { info, test }
}
