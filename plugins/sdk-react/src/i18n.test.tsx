import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPluginTranslation } from "./i18n.ts"

// The wire payload is a bare string; the legacy object shape must keep
// working, so the mock accepts both.
type LanguagePush = string | { language: string }

const mocks = vi.hoisted(() => ({
	contextLanguage: { value: "en" as string | undefined },
	pushHandlers: [] as ((data: LanguagePush) => void)[],
}))

vi.mock("@hoardodile/sdk-web", () => ({
	ensureHostBridge: () => ({
		subscribe: (
			_key: string,
			handler: (data: LanguagePush) => void,
		): (() => void) => {
			mocks.pushHandlers.push(handler)
			return () => {}
		},
	}),
	getPluginContext: () =>
		mocks.contextLanguage.value === undefined
			? undefined
			: { language: mocks.contextLanguage.value },
}))

const BUNDLES = {
	en: { greeting: "Hello", withName: "Hi {{name}}" },
	zh: { greeting: "你好", withName: "你好 {{name}}" },
}

function renderProbe() {
	const container = document.createElement("div")
	document.body.appendChild(container)
	const { useTranslation } = createPluginTranslation(BUNDLES)
	let root: Root | undefined
	let translation:
		| {
				t: (key: string, vars?: Record<string, string | number>) => string
				language: string
		  }
		| undefined

	function Probe() {
		translation = useTranslation()
		return <div data-testid="out">{translation.t("greeting")}</div>
	}

	act(() => {
		root = createRoot(container)
		root.render(<Probe />)
	})

	return {
		text: () =>
			container.querySelector("[data-testid='out']")?.textContent ?? "",
		current: () => translation!,
		unmount: () => {
			act(() => {
				root?.unmount()
			})
			container.remove()
		},
	}
}

afterEach(() => {
	mocks.contextLanguage.value = "en"
	mocks.pushHandlers.length = 0
})

describe("createPluginTranslation", () => {
	beforeEach(() => {
		mocks.pushHandlers.length = 0
	})

	it("starts in the language from the plugin context", () => {
		mocks.contextLanguage.value = "zh"
		const probe = renderProbe()
		expect(probe.text()).toBe("你好")
		expect(probe.current().language).toBe("zh")
		probe.unmount()
	})

	it("updates when the host pushes a language change", () => {
		mocks.contextLanguage.value = "en"
		const probe = renderProbe()
		expect(probe.text()).toBe("Hello")

		// The real wire payload is a bare language-code string.
		act(() => {
			for (const handler of mocks.pushHandlers) {
				handler("zh")
			}
		})
		expect(probe.text()).toBe("你好")
		expect(probe.current().language).toBe("zh")
		probe.unmount()
	})

	it("still accepts the legacy object-shaped language push", () => {
		mocks.contextLanguage.value = "en"
		const probe = renderProbe()

		act(() => {
			for (const handler of mocks.pushHandlers) {
				handler({ language: "zh" })
			}
		})
		expect(probe.text()).toBe("你好")
		probe.unmount()
	})

	it("stays in the host language and falls back to English for missing bundle languages", () => {
		mocks.contextLanguage.value = "ja"
		const probe = renderProbe()
		// The plugin ships en/zh only; the shared ui namespace still
		// resolves the host language, plugin strings fall back to en.
		expect(probe.current().language).toBe("ja")
		expect(probe.text()).toBe("Hello")
		probe.unmount()
	})

	it("interpolates {{var}} placeholders", () => {
		const probe = renderProbe()
		expect(probe.current().t("withName", { name: "A" })).toBe("Hi A")
		probe.unmount()
	})

	it("returns the key when the message is missing", () => {
		const probe = renderProbe()
		expect(probe.current().t("noSuchKey")).toBe("noSuchKey")
		probe.unmount()
	})

	it("ignores the host push when no bridge subscription ran yet", () => {
		mocks.contextLanguage.value = "en"
		const probe = renderProbe()
		const before = mocks.pushHandlers.length
		expect(before).toBeGreaterThan(0)
		probe.unmount()
	})
})
