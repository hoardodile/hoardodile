import "./index.css"

import { I18nProvider } from "@hoardodile/i18n/react"
import type { HoardodileDesktopBridge } from "@hoardodile/shared/desktop"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { i18n } from "./i18n.ts"
import { ShellPages } from "./shell-pages.tsx"
import { WizardApp } from "./WizardApp.tsx"

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"

function applySystemTheme(): void {
	const root = document.documentElement
	const dark = window.matchMedia(COLOR_SCHEME_QUERY).matches
	root.classList.remove("light", "dark")
	root.classList.add(dark ? "dark" : "light")
}

applySystemTheme()
window
	.matchMedia(COLOR_SCHEME_QUERY)
	.addEventListener("change", applySystemTheme)

declare global {
	interface Window {
		hoardodileDesktop?: HoardodileDesktopBridge
	}
}

const root = document.getElementById("root")
if (root === null) throw new Error("#root element not found")

const params = new URLSearchParams(window.location.search)
const ui =
	params.get("mode") === "error" ? (
		<ShellPages message={params.get("message") ?? undefined} />
	) : (
		<WizardApp />
	)

createRoot(root).render(
	<StrictMode>
		<I18nProvider i18n={i18n}>{ui}</I18nProvider>
	</StrictMode>,
)

// The raw-HTML splash (index.html) keeps the first frame from being a
// white flash before React mounts; drop it right after the app's first
// paint, when the wizard or the shell error page is already rendered.
requestAnimationFrame(() => {
	requestAnimationFrame(() => {
		document.getElementById("app-splash")?.remove()
	})
})
