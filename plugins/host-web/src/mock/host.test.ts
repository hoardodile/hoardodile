import type { PluginIframeContext } from "@hoardodile/sdk-web"
import { createIframeHostAPI, ensureHostBridge } from "@hoardodile/sdk-web"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createInMemoryFileBackend } from "./file-backends.ts"
import { createMockHost } from "./host.ts"

/**
 * Full bridge round-trip in jsdom: the plugin-side runtime posts to
 * `window.parent` (itself here), the mock host listens on the same
 * window, and responses come back through the same postMessage channel —
 * the exact wire a real sandboxed iframe uses.
 */

function buildContext(
	overrides: Partial<PluginIframeContext> = {},
): PluginIframeContext {
	return {
		pluginId: "test-plugin",
		resId: "r-1",
		resName: "Test Resource",
		sourceMeta: undefined,
		searchMeta: undefined,
		fileStats: undefined,
		contentPluginId: "test-plugin",
		language: "en",
		resolvedTheme: "dark",
		palette: "parchment",
		iconStyle: "duotone",
		fonts: { family: "", cssPaths: [] },
		initialPrefs: {},
		initialCache: {},
		fileToken: "",
		assetToken: "",
		...overrides,
	}
}

afterEach(() => {
	// Ensure no global bridge listener leaks between tests.
	window.parent.postMessage = window.parent.postMessage
})

describe("createMockHost bridge", () => {
	test("listFiles and readFile round-trip through postMessage", async () => {
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend({ "a.txt": "hello", "b.bin": "beta" }),
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			// No listFileEntries: the server's own fallback is bare,
			// naturally sorted filenames.
			expect(await api.listFiles()).toEqual(["a.txt", "b.bin"])
			const data = await api.readFile("a.txt")
			expect(new TextDecoder().decode(data)).toBe("hello")
		} finally {
			host.dispose()
		}
	})

	test("the listFiles fallback sorts naturally, not lexicographically", async () => {
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend({
				"10.png": "a",
				"2.png": "b",
				"1.png": "c",
			}),
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			expect(await api.listFiles()).toEqual(["1.png", "2.png", "10.png"])
		} finally {
			host.dispose()
		}
	})

	test("listFileEntries serves the plugin's own file rows", async () => {
		const pluginRows = [
			{ filename: "01.jpg", type: "image", width: 800, height: 1200 },
			{ filename: "clip.mp4", type: "video", durationMs: 4200 },
		]
		const host = createMockHost({
			targetWindow: window,
			files: {
				...createInMemoryFileBackend({ "01.jpg": "a", "clip.mp4": "b" }),
				listFileEntries: async () => pluginRows,
			},
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			expect(await api.listFiles()).toEqual(pluginRows)
		} finally {
			host.dispose()
		}
	})

	test("listFileEntries returning undefined falls back to bare filenames", async () => {
		const host = createMockHost({
			targetWindow: window,
			files: {
				...createInMemoryFileBackend({ "a.txt": "hello" }),
				listFileEntries: async () => undefined,
			},
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			expect(await api.listFiles()).toEqual(["a.txt"])
		} finally {
			host.dispose()
		}
	})

	test("messages round-trip into the in-memory store", async () => {
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend(),
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			const created = await api.createMessage({
				body: "hello world",
				anchor: { data: { page: 2 } },
			})
			expect(created.body).toBe("hello world")
			expect((created.anchor as { resId: string }).resId).toBe("r-1")

			const list = await api.listMessages()
			expect(list).toHaveLength(1)
			expect(list[0]?.body).toBe("hello world")
		} finally {
			host.dispose()
		}
	})

	test("prefs and cache writes land in the host maps", async () => {
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend(),
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			// setPref/setCache are fire-and-forget on the wire — poll for
			// the request to land in the host maps.
			api.setPref("theme", "dark")
			await vi.waitFor(() => expect(host.prefs.get("theme")).toBe("dark"))
			api.setCache("scroll", "42")
			await vi.waitFor(() => expect(host.cache.get("r-1:scroll")).toBe("42"))
		} finally {
			host.dispose()
		}
	})

	test("requests from unregistered sources are dropped", async () => {
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend({ "a.txt": "hello" }),
		})
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			// No registration: the request never resolves. The bridge's
			// request timeout (10s) bounds the wait.
			await expect(api.listFiles()).rejects.toThrow(/timed out/)
		} finally {
			host.dispose()
		}
	}, 15_000)

	test("uploadCover round-trips and reports the filename", async () => {
		const onUploadCover = vi.fn()
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend(),
			onUploadCover,
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			const result = await api.uploadCover({
				file: new ArrayBuffer(4),
				filename: "cover.png",
			})
			expect(result).toEqual({ path: "/api/resources/r-1/cover" })
			expect(onUploadCover).toHaveBeenCalledWith("r-1", "cover.png")
		} finally {
			host.dispose()
		}
	})

	test("uploadCover rejects invalid params (file not a byte container)", async () => {
		const host = createMockHost({
			targetWindow: window,
			files: createInMemoryFileBackend(),
		})
		host.register(window, { pluginId: "test-plugin", resId: "r-1" })
		try {
			ensureHostBridge()
			const api = createIframeHostAPI(buildContext())

			await expect(
				api.uploadCover({ file: {} as never, filename: "" }),
			).rejects.toThrow(/Invalid params for uploadCover/)
		} finally {
			host.dispose()
		}
	})
})
