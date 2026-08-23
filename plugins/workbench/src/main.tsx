import { TooltipProvider } from "@hoardodile/ui/components/tooltip"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { ErrorBoundary } from "./ErrorBoundary.tsx"
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
		<TooltipProvider>
			<App />
		</TooltipProvider>
	</ErrorBoundary>,
)
