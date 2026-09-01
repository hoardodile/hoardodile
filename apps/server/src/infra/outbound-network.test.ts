import { tmpdir } from "node:os"
import { resolveProxyConfig } from "@hoardodile/shared/net-proxy"
import type { PluginDownloader } from "src/domain/plugin/downloader.ts"
import { describe, expect, test } from "vitest"
import { createOutboundNetwork } from "./outbound-network.ts"

// `info()` never touches the fetcher, so a narrow stub is enough for the
// proxy-resolution assertions (cast through `satisfies` to keep the shape).
const stubFetcher = {
	vetUrl: () => "",
	fetchToFile: async () => ({ sizeBytes: 0, sha256: "" }),
	probeSize: async () => undefined,
} satisfies PluginDownloader

describe("createOutboundNetwork", () => {
	test("info reflects the currently resolved proxy (re-read per call)", () => {
		let proxy: string | undefined
		const net = createOutboundNetwork({
			config: () =>
				resolveProxyConfig(
					proxy === undefined ? {} : { HOARDODILE_PROXY: proxy },
					"linux",
				),
			fetcher: stubFetcher,
			tmpDir: tmpdir(),
		})

		expect(net.info()).toMatchObject({
			source: "none",
			httpHost: null,
			httpsHost: null,
			bypassCount: 0,
		})

		// A proxy enabled after boot is reflected on the next read — no
		// restart — because the resolver is re-read per call.
		proxy = "http://127.0.0.1:7897"
		expect(net.info()).toMatchObject({
			source: "explicit",
			httpHost: "127.0.0.1:7897",
			httpsHost: "127.0.0.1:7897",
		})
	})
})
