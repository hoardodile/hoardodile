import { createWebPluginAPI, type DeepPartial } from "@hoardodile/sdk-web"
import type { ReactNode } from "react"
import { type BasePluginAPI, PluginAPIProvider } from "./context.tsx"

export { createWebPluginAPI, type DeepPartial } from "@hoardodile/sdk-web"

/**
 * Wrap children with a stubbed API provider for tests. Builds the stub
 * via `createWebPluginAPI` from `@hoardodile/sdk-web` (re-exported
 * below) — the imperative surface plus no-op reactive hooks, overridable
 * via `api`.
 */
export function StubPluginAPIProvider({
	api,
	children,
}: {
	readonly api?: DeepPartial<BasePluginAPI>
	readonly children: ReactNode
}) {
	return (
		<PluginAPIProvider value={createWebPluginAPI(api)}>
			{children}
		</PluginAPIProvider>
	)
}
