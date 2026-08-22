import { hostPushKeys } from "@hoardodile/sdk-web"
import { render, waitFor } from "@testing-library/react"
import { useTranslation } from "react-i18next"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { broadcastToAll } from "@/features/plugin/iframe/iframe-registry"
import {
	__clearMockPrefs,
	__getMockSetter,
	__setMockPrefValue,
} from "@/hooks/usePrefSync"
import { LanguagePrefSync } from "./PrefsSync"

declare module "@/hooks/usePrefSync" {
	export function __setMockPrefValue(key: string, value: string): void
	export function __clearMockPrefs(): void
	export function __getMockSetter(key: string): ReturnType<typeof vi.fn>
}

vi.mock("@/features/plugin/iframe/iframe-registry", () => ({
	broadcastToAll: vi.fn(),
}))

vi.mock("react-i18next", () => ({
	useTranslation: vi.fn(),
}))

vi.mock("@/hooks/usePrefSync", () => {
	const values: Record<string, string> = {}
	const setters: Record<string, ReturnType<typeof vi.fn>> = {}

	function ensureSetter(key: string): ReturnType<typeof vi.fn> {
		if (setters[key] === undefined) {
			setters[key] = vi.fn((value: string) => {
				values[key] = value
			})
		}
		return setters[key]
	}

	return {
		useStringPrefSync: (key: string, defaultValue: string) => {
			return [values[key] ?? defaultValue, ensureSetter(key)]
		},
		usePrefSync: (key: string, defaultValue: unknown, _codec?: unknown) => {
			return [values[key] ?? defaultValue, ensureSetter(key)]
		},
		__setMockPrefValue: (key: string, value: string): void => {
			values[key] = value
		},
		__clearMockPrefs: (): void => {
			for (const key of Object.keys(values)) {
				delete values[key]
			}
			for (const key of Object.keys(setters)) {
				delete setters[key]
			}
		},
		__getMockSetter: (key: string): ReturnType<typeof vi.fn> =>
			ensureSetter(key),
	}
})

let currentLang = "en"
const changeLanguage = vi.fn(async (lng: string) => {
	currentLang = lng
})

let i18nMock: {
	readonly resolvedLanguage: string
	readonly language: string
	readonly changeLanguage: typeof changeLanguage
	readonly on: ReturnType<typeof vi.fn>
	readonly off: ReturnType<typeof vi.fn>
}

function mockUseTranslation() {
	return {
		t: (key: string) => key,
		i18n: i18nMock,
	} as unknown as ReturnType<typeof useTranslation>
}

describe("LanguagePrefSync", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		__clearMockPrefs()
		currentLang = "en"
		i18nMock = {
			get resolvedLanguage() {
				return currentLang
			},
			get language() {
				return currentLang
			},
			changeLanguage,
			on: vi.fn(),
			off: vi.fn(),
		}
		vi.mocked(useTranslation).mockImplementation(mockUseTranslation)
		document.documentElement.lang = "en"
	})

	it("applies server-hydrated language after a hard reset without writing the fallback back", async () => {
		const { rerender } = render(<LanguagePrefSync />)

		expect(changeLanguage).not.toHaveBeenCalled()
		expect(document.documentElement.lang).toBe("en")

		// Simulate hydrateSystemPrefs loading a different language from the
		// restored database.
		__setMockPrefValue("language", "zh")
		rerender(<LanguagePrefSync />)

		await waitFor(() => expect(changeLanguage).toHaveBeenCalledWith("zh"))
		expect(__getMockSetter("language")).not.toHaveBeenCalledWith("en")
	})

	it("writes user-initiated language changes to prefSync and broadcasts them", async () => {
		// Seed the existing preference so syncedLang stays "en" while current
		// changes to "zh", mirroring a normal (non-reset) session.
		__setMockPrefValue("language", "en")
		const { rerender } = render(<LanguagePrefSync />)

		currentLang = "zh"
		rerender(<LanguagePrefSync />)

		await waitFor(() =>
			expect(__getMockSetter("language")).toHaveBeenCalledWith("zh"),
		)
		expect(broadcastToAll).toHaveBeenCalledWith({
			type: "push",
			key: hostPushKeys.languageChanged,
			data: "zh",
		})
	})

	it("keeps document.documentElement.lang in sync with the active language", async () => {
		const { rerender } = render(<LanguagePrefSync />)
		expect(document.documentElement.lang).toBe("en")

		currentLang = "zh"
		rerender(<LanguagePrefSync />)

		await waitFor(() => expect(document.documentElement.lang).toBe("zh"))
	})
})
