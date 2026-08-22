import "./index.css"

import type { HoardodileDesktopBridge } from "@hoardodile/shared/desktop"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
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

createRoot(root).render(
	<StrictMode>
		<WizardApp />
	</StrictMode>,
)
