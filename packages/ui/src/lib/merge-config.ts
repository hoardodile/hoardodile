import { extendTailwindMerge } from "tailwind-merge"

// The app's `@theme inline` tokens (theme.css) generate utility names
// tailwind-merge doesn't know, so it misclassifies them — e.g. `text-ui` is
// parsed as a text color and dropped next to any `text-*` color. The default
// class groups are theme-backed, so extending the theme (keys mirror the v4
// token namespaces one-to-one) registers every custom utility with correct
// conflict semantics. merge-config.test.ts pins this list against theme.css.
export const mergeTheme = {
	text: ["tiny", "ui", "doc", "doc-title", "doc-heading", "quote"],
	spacing: ["chip", "control", "nav", "sidebar", "panel"],
	tracking: ["label"],
	shadow: ["card", "dialog"],
	container: ["reading", "medium", "content"],
	font: ["doc", "heading"],
	ease: ["standard"],
	animate: ["skel", "pop"],
} as const

export const twMerge = extendTailwindMerge({
	extend: { theme: mergeTheme },
})
