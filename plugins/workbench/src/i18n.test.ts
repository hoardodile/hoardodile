import { getI18n } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

/**
 * Guards the workbench i18n instance: it boots with the `translation` +
 * `ui` + `workbench` namespaces for every supported language and is bound
 * as react-i18next's default instance (the bug this guards: the workbench
 * chrome's `useTranslation` rendered raw keys because the instance was
 * never bound and the workspace keeps more than one physical react-i18next
 * copy). Standalone instance access keeps this test in the node env the
 * package's vitest config uses (no jsdom).
 */

let originalNavigator: PropertyDescriptor | undefined

beforeEach(() => {
	originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
	Object.defineProperty(globalThis, "navigator", {
		value: { language: "en" },
		configurable: true,
	})
})

afterEach(() => {
	if (originalNavigator === undefined) {
		delete (globalThis as Record<string, unknown>).navigator
	} else {
		Object.defineProperty(globalThis, "navigator", originalNavigator)
	}
})

describe("workbench i18n", () => {
	it("is bound as react-i18next's default instance", async () => {
		const { i18n } = await import("./i18n.ts")
		await i18n.changeLanguage("zh")
		// The instance the module created must be the one `useTranslation`
		// resolves by default (otherwise the chrome falls back to keys).
		expect(getI18n()).toBe(i18n)
	})

	it("translates the chrome namespace and switches language", async () => {
		const { i18n } = await import("./i18n.ts")
		// The `workbench` namespace is not part of i18next's strictly-typed
		// resource set, so cast to a loose signature (the catalog is parity-
		// checked elsewhere). The chrome calls `useTranslation("workbench")`.
		const t = i18n.t as (key: string, opts?: Record<string, unknown>) => string
		expect(t("app.loading", { ns: "workbench", lng: "en" })).toBe("loading…")
		expect(t("app.loading", { ns: "workbench", lng: "zh" })).toBe("加载中…")
		expect(t("popover.configure", { ns: "workbench", lng: "zh" })).toBe("配置")
	})

	it("serves the translation and ui namespaces", async () => {
		const { i18n } = await import("./i18n.ts")
		// `translation` (the app catalog) is the default namespace.
		expect(i18n.t("common.cancel", { lng: "zh" })).not.toBe("common.cancel")
		expect(i18n.t("common.cancel", { lng: "zh" })).toBeTruthy()
		// The shared `ui` namespace is available to @hoardodile/ui components.
		expect(i18n.t("closeConfirm.cancel", { ns: "ui", lng: "en" })).toBe(
			"Cancel",
		)
	})
})
