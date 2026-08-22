/**
 * Route path patterns for the desktop shell's navigation policy.
 *
 * The SPA registers its real routes (from the generated `routeTree.gen.ts`)
 * with the Electron main process once at boot; the shell then allows a
 * same-origin navigation to replace the app window only when its pathname
 * matches one of these patterns. New routes therefore extend the allowlist
 * automatically — the shell never needs to know them in advance.
 */

export type RouteTreeLike = {
	readonly fullPath: string
	readonly children?: unknown
}

/**
 * TanStack Router fills `fullPath` in during `createRouter`; children end
 * up as the Object.values of the generated file-route record (arrays at
 * runtime). Call this after `createRouter`, like `main.tsx` does.
 */
export function collectRoutePaths(tree: RouteTreeLike): string[] {
	const paths = new Set<string>()
	const visit = (node: RouteTreeLike): void => {
		paths.add(normalizeFullPath(node.fullPath))
		const { children } = node
		if (typeof children !== "object" || children === null) return
		for (const child of Object.values(children)) {
			if (isRouteNode(child)) visit(child)
		}
	}
	visit(tree)
	return [...paths]
}

function isRouteNode(value: unknown): value is RouteTreeLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { fullPath?: unknown }).fullPath === "string"
	)
}

/** TanStack full paths: trailing slashes folded (`/characters/` → `/characters`). */
function normalizeFullPath(fullPath: string): string {
	if (fullPath === "/") return "/"
	const trimmed = fullPath.replace(/\/+$/, "")
	return trimmed.length > 0 ? trimmed : "/"
}
