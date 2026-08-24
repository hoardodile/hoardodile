import { I18nProvider } from "@hoardodile/i18n/react"
import { TooltipProvider } from "@hoardodile/ui/components/tooltip"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { ErrorBoundary } from "./ErrorBoundary.tsx"
import { i18n } from "./i18n.ts"
import "./index.css"

// No StrictMode on purpose: the plugin iframe and the mock host live
// imperatively (same ownership model as the app's iframe pool) and a
// double-invoked effect would mount, tear down and re-create the iframe
// on every dev reload.
const rootElement = document.getElementById("root")
if (rootElement === null) {
	throw new Error("#root element not found")
}

createRoot(rootElement).render(
	<ErrorBoundary>
		<I18nProvider i18n={i18n}>
			<TooltipProvider>
				<App />
			</TooltipProvider>
		</I18nProvider>
	</ErrorBoundary>,
)
