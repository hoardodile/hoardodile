import type { IconType } from "@hoardodile/ui/components/icon"
import type { IconMode } from "@hoardodile/ui/icons/icon-style"
import { useEffect, useState } from "react"
import { SOLAR_GLYPH_NAMES } from "./solar-names.generated"

/**
 * Lazy Solar glyph renderer for manifest/template icons.
 *
 * The loader module (`solar-loaders.generated.ts`) is itself lazily
 * imported: it turns a Solar glyph name into the same `createIcon`-wrapped
 * component the static registry exports — carrying all three weights
 * (bold / boldDuotone / linear), the icon-style preference subscription
 * (Settings → Icons), the `mode` override and the `hd-icon` hook class.
 * This component only bridges the async boundary: it loads the wrapped
 * component once per glyph (the loader caches the promise) and renders
 * `null` until then. Unknown names render `null` — icon resolution never
 * throws.
 */

export type SolarIconLoader = (name: string) => Promise<IconType | undefined>

async function defaultLoader(name: string): Promise<IconType | undefined> {
	const index = await import("./solar-loaders.generated")
	return index.loadSolarGlyph(name)
}

export function LazySolarIcon(props: {
	/** Normalized Solar glyph name (kebab-case). */
	readonly name: string
	/** Weight override (`"bold"` for selected states) — same semantics as `Icon`. */
	readonly mode?: IconMode
	readonly className?: string
	/** Test seam: replaces the generated index lookup. */
	readonly loader?: SolarIconLoader
}) {
	const { name, mode, className } = props
	const loader = props.loader ?? defaultLoader
	// The state wraps the component in an object: a bare function value
	// would be invoked by React as a lazy state updater.
	const [loaded, setLoaded] = useState<{ readonly glyph: IconType } | null>(
		null,
	)

	useEffect(() => {
		let cancelled = false
		const promise = loader(name)
		promise.then((glyph) => {
			if (!cancelled && glyph !== undefined) setLoaded({ glyph })
		})
		return () => {
			cancelled = true
		}
	}, [name, loader])

	const Component = loaded?.glyph
	if (Component === undefined) return null
	return <Component mode={mode} className={className} />
}

const lazyComponentCache = new Map<string, IconType>()

/**
 * Resolve a (normalized) Solar glyph name to a render-ready `IconType`
 * component, or `undefined` when the name is not in the generated index.
 * The returned component is memoized per glyph and renders `null` until
 * the glyph's chunks arrive — it is directly usable anywhere an
 * `IconType` is expected (e.g. `IconTile`).
 */
export function resolveSolarIconComponent(name: string): IconType | undefined {
	if (!SOLAR_GLYPH_NAMES.has(name)) return undefined
	let component = lazyComponentCache.get(name)
	if (component === undefined) {
		component = function SolarGlyph({
			mode,
			className,
		}: {
			readonly mode?: IconMode
			readonly className?: string
		}) {
			return <LazySolarIcon name={name} mode={mode} className={className} />
		}
		lazyComponentCache.set(name, component)
	}
	return component
}
