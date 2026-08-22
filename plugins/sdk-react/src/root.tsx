import type { PluginSchema } from "@hoardodile/sdk-types"
import {
	applyFonts,
	applyTheme,
	createIframeHostAPI,
	ensureHostBridge,
	getVisibilitySnapshot,
	mountPlugin,
	subscribeToVisibility,
} from "@hoardodile/sdk-web"
import type { ComponentType, Provider, ReactNode } from "react"
import { createElement, useEffect, useSyncExternalStore } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { usePluginAPI } from "./context.tsx"
import type { FullPluginAPI } from "./define-api.ts"
import { createPluginQueryAPI } from "./query.ts"

export type PluginRootConfig<TSchema extends PluginSchema = PluginSchema> = {
	/** Root component rendered inside the plugin iframe. */
	readonly render: ComponentType
	/**
	 * Typed provider returned by {@link definePluginAPI}. This is the single
	 * source of truth for the plugin schema type.
	 */
	readonly provider: Provider<FullPluginAPI<TSchema> | null>
	/**
	 * When `true` (default), the whole plugin tree remounts whenever the
	 * iframe is rebound to another resource — the safe choice: all
	 * per-resource state resets automatically.
	 *
	 * Set to `false` for fine-grained updates (e.g. cheap same-plugin
	 * navigation): the mounted tree stays alive and only re-renders with
	 * the new `api`. Queries refetch automatically, but every piece of
	 * per-resource state becomes the plugin's own responsibility — key
	 * subtrees and memos by `api.resource.id` and reset any hydration
	 * flags yourself.
	 */
	readonly remountOnResourceChange?: boolean
}

function ThemeSync({ children }: { readonly children: ReactNode }) {
	const api = usePluginAPI()
	const { resolvedTheme, palette, iconStyle } = api.useTheme()

	useEffect(
		function applyOnChange() {
			applyTheme(resolvedTheme, palette, iconStyle)
		},
		[resolvedTheme, palette, iconStyle],
	)

	return children
}

function FontSync({ children }: { readonly children: ReactNode }) {
	const api = usePluginAPI()
	const { family, cssPaths } = api.useFont()

	useEffect(
		function applyOnChange() {
			applyFonts(family, cssPaths)
		},
		[family, cssPaths],
	)

	return children
}

/**
 * Subscribe to the iframe visibility state from the host: `false` while
 * the iframe is parked offscreen in the preview window. Do NOT gate
 * rendering on it — parked slots are meant to pre-paint so a flip is a
 * style swap, and an empty tree defeats that. Use visibility only to
 * pause active behavior: media playback, autoplay, timers.
 */
export function useVisibility(): boolean {
	return useSyncExternalStore(subscribeToVisibility, getVisibilitySnapshot)
}

/**
 * One-call plugin bootstrap. Handles `mountPlugin`, `createRoot` caching,
 * iframe host API, typed `PluginAPIProvider`, reactive theme application, and
 * visibility subscription.
 *
 * The supplied component receives no props; it should call `usePluginAPI()`
 * and `useVisibility()` internally as needed. By default the root remounts
 * when the resource changes (see
 * {@link PluginRootConfig.remountOnResourceChange}); even then, use
 * `api.resource.id` as a key inside your component if you need finer
 * control.
 */
export function createPluginRoot<TSchema extends PluginSchema = PluginSchema>(
	config: PluginRootConfig<TSchema>,
): void {
	let root: ReturnType<typeof createRoot> | undefined

	mountPlugin(function onContext(ctx) {
		flushSync(() => {
			if (root === undefined) {
				const el = document.getElementById("root")
				if (el === null) {
					console.error("[plugin] #root element not found — cannot mount")
					return
				}
				root = createRoot(el)
			}
			const host = ensureHostBridge()
			const baseApi = createIframeHostAPI<TSchema>(ctx)
			const api: FullPluginAPI<TSchema> = {
				...baseApi,
				...createPluginQueryAPI(host, {
					resolvedTheme: ctx.resolvedTheme,
					palette: ctx.palette,
					iconStyle: ctx.iconStyle,
					fonts: ctx.fonts,
					resId: ctx.resId,
				}),
			}
			applyTheme(ctx.resolvedTheme, ctx.palette, ctx.iconStyle)
			applyFonts(ctx.fonts.family, ctx.fonts.cssPaths)
			root.render(
				createElement(
					config.provider,
					{ value: api },
					createElement(
						ThemeSync,
						null,
						createElement(
							FontSync,
							null,
							createElement(
								config.render,
								config.remountOnResourceChange === false
									? {}
									: { key: ctx.resId },
							),
						),
					),
				),
			)
		})
	})
}
