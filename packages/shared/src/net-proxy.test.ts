import { describe, expect, test } from "vitest"
import {
	bypassMatches,
	createProxyResolver,
	defaultSystemSnapshot,
	describeProxy,
	GITHUB_ASSET_HOSTS,
	isPublicAddress,
	parseMacScutilOutput,
	parseWindowsProxyOutput,
	proxyAgentFor,
	proxyFor,
	proxyTargetAllowed,
	resolveProxyConfig,
	TRUSTED_GITHUB_HOSTS,
	toProxyRules,
} from "./net-proxy.ts"

const WIN_REG_OUTPUT = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyOverride    REG_SZ    localhost;127.*;192.168.*;<local>
    ProxyServer    REG_SZ    127.0.0.1:7897
`

const WIN_REG_HTTP_HTTPS_OUTPUT = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    http=127.0.0.1:7897;https=127.0.0.1:7898
`

const MAC_SCUTIL_OUTPUT = `
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7898
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
  ExceptionsList : <array> {
    0 : "*.local"
    1 : "169.254/16"
  }
}
`

describe("resolveProxyConfig", () => {
	test("the explicit override beats env vars and applies to both protocols", () => {
		const config = resolveProxyConfig(
			{
				HOARDODILE_PROXY: "http://127.0.0.1:8080",
				HTTPS_PROXY: "http://proxy.example:3128",
			},
			"linux",
		)
		expect(config.source).toBe("explicit")
		expect(config.http?.host).toBe("127.0.0.1:8080")
		expect(config.https?.host).toBe("127.0.0.1:8080")
	})

	test("`off` disables proxying entirely", () => {
		const config = resolveProxyConfig(
			{ HOARDODILE_PROXY: "off", HTTPS_PROXY: "http://proxy.example:3128" },
			"linux",
		)
		expect(config.source).toBe("none")
		expect(config.http).toBeNull()
		expect(config.https).toBeNull()
	})

	test("an https:// override is rejected loudly", () => {
		expect(() =>
			resolveProxyConfig(
				{ HOARDODILE_PROXY: "https://127.0.0.1:8080" },
				"linux",
			),
		).toThrow(/only http proxies are supported/)
	})

	test("reads standard env vars per protocol (https uses HTTPS_PROXY/ALL_PROXY)", () => {
		const config = resolveProxyConfig(
			{
				HTTPS_PROXY: "http://secure-proxy:3128",
				http_proxy: "http://plain-proxy:3129",
			},
			"linux",
		)
		expect(config.source).toBe("env")
		expect(config.https?.host).toBe("secure-proxy:3128")
		expect(config.http?.host).toBe("plain-proxy:3129")
	})

	test("lowercase vars and ALL_PROXY serve as fallbacks", () => {
		const config = resolveProxyConfig(
			{ ALL_PROXY: "http://any-proxy:3129" },
			"linux",
		)
		expect(config.https?.host).toBe("any-proxy:3129")
		expect(config.http?.host).toBe("any-proxy:3129")
	})

	test("a malformed proxy env never breaks resolution — it is skipped", () => {
		const config = resolveProxyConfig(
			{
				HTTPS_PROXY: "socks5://127.0.0.1:1080",
				HTTP_PROXY: "http://good:3128",
			},
			"linux",
		)
		expect(config.http?.host).toBe("good:3128")
		expect(config.https).toBeNull()
	})

	test("env source merges the OS bypass list", () => {
		const config = resolveProxyConfig(
			{ HTTPS_PROXY: "http://proxy.example:3128" },
			"win32",
			() => ({ platform: "win32", raw: WIN_REG_OUTPUT }),
		)
		expect(config.source).toBe("env")
		expect(config.bypass).toContain("127.*")
	})

	test("falls back to the Windows system proxy when no env proxy is set", () => {
		const config = resolveProxyConfig({}, "win32", () => ({
			platform: "win32",
			raw: WIN_REG_OUTPUT,
		}))
		expect(config.source).toBe("system")
		expect(config.https?.host).toBe("127.0.0.1:7897")
		expect(config.http?.host).toBe("127.0.0.1:7897")
	})

	test("falls back to the macOS system proxy when no env proxy is set", () => {
		const config = resolveProxyConfig({}, "darwin", () => ({
			platform: "darwin",
			raw: MAC_SCUTIL_OUTPUT,
		}))
		expect(config.source).toBe("system")
		expect(config.http?.host).toBe("127.0.0.1:7897")
		expect(config.https?.host).toBe("127.0.0.1:7898")
		expect(config.bypass).toEqual(["*.local", "169.254/16"])
	})

	test("resolves to none when nothing is available", () => {
		const config = resolveProxyConfig({}, "linux", () => null)
		expect(config.source).toBe("none")
		expect(config.http).toBeNull()
	})
})

describe("parseWindowsProxyOutput", () => {
	test("parses a plain host:port into both protocols plus the override list", () => {
		const parsed = parseWindowsProxyOutput(WIN_REG_OUTPUT)
		expect(parsed.http?.host).toBe("127.0.0.1:7897")
		expect(parsed.https?.host).toBe("127.0.0.1:7897")
		expect(parsed.bypass).toEqual([
			"localhost",
			"127.*",
			"192.168.*",
			"<local>",
		])
	})

	test("parses the per-protocol ProxyServer map", () => {
		const parsed = parseWindowsProxyOutput(WIN_REG_HTTP_HTTPS_OUTPUT)
		expect(parsed.http?.host).toBe("127.0.0.1:7897")
		expect(parsed.https?.host).toBe("127.0.0.1:7898")
	})

	test("returns null proxies when the system proxy is disabled", () => {
		const parsed = parseWindowsProxyOutput(
			WIN_REG_OUTPUT.replace("    0x1", "    0x0"),
		)
		expect(parsed.http).toBeNull()
		expect(parsed.https).toBeNull()
	})
})

describe("parseMacScutilOutput", () => {
	test("parses addresses, ports, and the exceptions list", () => {
		expect(parseMacScutilOutput(MAC_SCUTIL_OUTPUT)).toEqual({
			http: expect.objectContaining({ host: "127.0.0.1:7897" }),
			https: expect.objectContaining({ host: "127.0.0.1:7898" }),
			bypass: ["*.local", "169.254/16"],
		})
	})
})

describe("bypassMatches", () => {
	test.each([
		["example.com", ["example.com"], true],
		["sub.example.com", ["example.com"], true],
		["example.com", [".example.com"], true],
		["sub.example.com", ["*.example.com"], true],
		["example.org", ["example.com"], false],
		["127.0.0.1", ["127.*"], true],
		["192.168.1.1", ["192.168.*"], true],
		["nas", ["<local>"], true],
		["nas.local", ["*.local"], true],
		["anything.at.all", ["*"], true],
		["host", ["host:8080"], true],
		["host.example.com", ["host:8443"], false],
	])("matches %s against %s", (host, entries, expected) => {
		expect(bypassMatches(host, entries)).toBe(expected)
	})
})

describe("proxyFor", () => {
	const config = resolveProxyConfig(
		{ HTTPS_PROXY: "http://proxy.example:3128" },
		"linux",
	)

	test("routes https through the proxy, http directly when unset", () => {
		expect(
			proxyFor(new URL("https://raw.githubusercontent.com/x"), config)?.host,
		).toBe("proxy.example:3128")
		expect(proxyFor(new URL("http://example.com/x"), config)).toBeNull()
	})

	test("never proxies loopback hosts", () => {
		for (const url of [
			"http://127.0.0.1:3000/health",
			"http://localhost:9/",
			"http://127.9.9.9/x",
		]) {
			expect(proxyFor(new URL(url), config)).toBeNull()
		}
	})

	test("honors bypass entries", () => {
		const withBypass = resolveProxyConfig(
			{
				HTTPS_PROXY: "http://proxy.example:3128",
				NO_PROXY: ".internal.example",
			},
			"linux",
		)
		expect(
			proxyFor(new URL("https://a.internal.example/x"), withBypass),
		).toBeNull()
	})
})

describe("toProxyRules", () => {
	test("mirrors the config for Chromium sessions", () => {
		const config = resolveProxyConfig(
			{ HTTPS_PROXY: "http://proxy.example:3128", NO_PROXY: "example.com" },
			"linux",
		)
		expect(toProxyRules(config)).toEqual({
			proxyRules: "https=proxy.example:3128",
			proxyBypassRules: "example.com,<local>",
		})
	})

	test("returns null when nothing is routed", () => {
		expect(toProxyRules(resolveProxyConfig({}, "linux", () => null))).toBeNull()
	})
})

describe("proxyAgentFor", () => {
	test("caches one agent per proxy URL and protocol", () => {
		const url = new URL("http://proxy.example:3128")
		expect(proxyAgentFor(url, "https")).toBe(proxyAgentFor(url, "https"))
		expect(proxyAgentFor(url, "https")).not.toBe(proxyAgentFor(url, "http"))
	})
})

describe("describeProxy", () => {
	test("states the source and host for logs", () => {
		expect(describeProxy(resolveProxyConfig({}, "linux", () => null))).toBe(
			"off (direct)",
		)
		expect(
			describeProxy(
				resolveProxyConfig({ HTTPS_PROXY: "http://127.0.0.1:7897" }, "linux"),
			),
		).toBe("env proxy 127.0.0.1:7897")
	})
})

describe("defaultSystemSnapshot", () => {
	test("returns null on platforms without a system proxy source", () => {
		expect(defaultSystemSnapshot("linux")).toBeNull()
	})
})

describe("isPublicAddress", () => {
	test.each([
		["1.1.1.1", true],
		["8.8.8.8", true],
		["127.0.0.1", false],
		["10.0.0.1", false],
		["192.168.1.1", false],
		["172.16.0.1", false],
		["172.32.0.1", true],
		["169.254.0.1", false],
		["100.64.0.1", false],
		["198.18.0.1", false],
		["192.0.2.1", false],
		["224.0.0.1", false],
		["::1", false],
		["fe80::1", false],
		["fd00::1", false],
		["ff02::1", false],
		["2001:db8::1", false],
		["2606:4700:4700::1111", true],
		["::ffff:192.168.1.1", false],
	])("classifies %s as %s", (address, expected) => {
		expect(isPublicAddress(address)).toBe(expected)
	})
})

describe("proxyTargetAllowed", () => {
	test("a locally public address always passes", () => {
		expect(proxyTargetAllowed("example.com", ["1.2.3.4"])).toBe(true)
	})

	test("non-public or missing resolution passes for trusted GitHub hosts", () => {
		expect(proxyTargetAllowed("raw.githubusercontent.com", [])).toBe(true)
		expect(
			proxyTargetAllowed("raw.githubusercontent.com", ["198.18.0.4"]),
		).toBe(true)
		expect(proxyTargetAllowed("raw.githubusercontent.com", ["10.0.0.1"])).toBe(
			true,
		)
	})

	test("non-public or missing resolution rejects everything else", () => {
		expect(proxyTargetAllowed("evil.example", [])).toBe(false)
		expect(proxyTargetAllowed("evil.example", ["198.18.0.4"])).toBe(false)
	})
})

describe("trusted GitHub hosts", () => {
	test("the proxy trust set covers every host the marketplace uses", () => {
		expect([...TRUSTED_GITHUB_HOSTS].sort()).toEqual([
			"api.github.com",
			"github.com",
			"objects.githubusercontent.com",
			"raw.githubusercontent.com",
			"release-assets.githubusercontent.com",
		])
		expect([...GITHUB_ASSET_HOSTS].sort()).toEqual([
			"github.com",
			"objects.githubusercontent.com",
			"release-assets.githubusercontent.com",
		])
	})
})

describe("proxy env helpers", () => {
	test("bypass entries from NO_PROXY are case-insensitive env names", () => {
		const config = resolveProxyConfig(
			{ https_proxy: "http://p:1", no_proxy: "internal, .corp" },
			"linux",
		)
		expect(config.source).toBe("env")
		expect(config.bypass).toEqual(["internal", ".corp"])
	})
})

describe("createProxyResolver", () => {
	test("caches the resolved config for the TTL window", () => {
		let calls = 0
		const resolver = createProxyResolver(
			() => {
				calls += 1
				return resolveProxyConfig(
					{ HOARDODILE_PROXY: "http://127.0.0.1:7897" },
					"linux",
				)
			},
			{ ttlMs: 10_000, now: () => 0 },
		)
		resolver()
		expect(resolver()).toBe(resolver())
		expect(calls).toBe(1)
	})

	test("re-resolves after the TTL elapses", () => {
		let calls = 0
		let t = 0
		const resolver = createProxyResolver(
			() => {
				calls += 1
				return resolveProxyConfig({}, "linux", () => null)
			},
			{ ttlMs: 1_000, now: () => t },
		)
		resolver()
		t = 1_000
		resolver()
		expect(calls).toBe(2)
	})

	test("returns the fresh value once the underlying resolution changes", () => {
		let on = true
		const resolver = createProxyResolver(
			() =>
				resolveProxyConfig(
					on
						? { HOARDODILE_PROXY: "http://127.0.0.1:7897" }
						: { HOARDODILE_PROXY: "off" },
					"linux",
				),
			{ ttlMs: 0 },
		)
		expect(resolver().https?.host).toBe("127.0.0.1:7897")
		on = false
		expect(resolver().https).toBeNull()
	})

	test("returns the same object and stays on the cache across many calls", () => {
		let calls = 0
		const resolver = createProxyResolver(
			() => {
				calls += 1
				return resolveProxyConfig({}, "linux", () => null)
			},
			{ ttlMs: 10_000 },
		)
		const first = resolver()
		for (let i = 0; i < 25; i += 1) expect(resolver()).toBe(first)
		expect(calls).toBe(1)
	})

	test("ttlMs 0 forces a re-resolve on every call", () => {
		let calls = 0
		const resolver = createProxyResolver(
			() => {
				calls += 1
				return resolveProxyConfig({}, "linux", () => null)
			},
			{ ttlMs: 0 },
		)
		resolver()
		resolver()
		resolver()
		expect(calls).toBe(3)
	})
})
