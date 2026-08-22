import type { ReactNode } from "react"

/**
 * Text-formatting toolbar glyphs, vendored from lucide-react v1.28.0
 * (ISC License — portions held by Cole Bemis 2013-2022 as part of
 * Feather, MIT; all other copyright held by Lucide Contributors 2022).
 * The editor toolbar keeps the exact icons the document tool uses; the
 * app bundles no lucide dependency, so these paths are committed here.
 */

type LucideNode =
	| readonly ["path", { readonly d: string }]
	| readonly [
			"line",
			{
				readonly x1: string
				readonly x2: string
				readonly y1: string
				readonly y2: string
			},
	  ]

function renderNode(node: LucideNode): ReactNode {
	if (node[0] === "path") {
		return <path key={node[1].d} d={node[1].d} />
	}
	return (
		<line
			key={`${node[1].x1}-${node[1].y1}`}
			x1={node[1].x1}
			y1={node[1].y1}
			x2={node[1].x2}
			y2={node[1].y2}
		/>
	)
}

function FormatIcon(props: {
	readonly nodes: readonly LucideNode[]
	readonly className?: string
}) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={props.className}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{props.nodes.map(renderNode)}
		</svg>
	)
}

function createIcon(nodes: readonly LucideNode[]) {
	return function FormattingIcon(props: { readonly className?: string }) {
		return <FormatIcon className={props.className} nodes={nodes} />
	}
}

export const BoldIcon = createIcon([
	[
		"path",
		{
			d: "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",
		},
	],
])

export const ItalicIcon = createIcon([
	["line", { x1: "19", x2: "10", y1: "4", y2: "4" }],
	["line", { x1: "14", x2: "5", y1: "20", y2: "20" }],
	["line", { x1: "15", x2: "9", y1: "4", y2: "20" }],
])

export const UnderlineIcon = createIcon([
	["path", { d: "M6 4v6a6 6 0 0 0 12 0V4" }],
	["line", { x1: "4", x2: "20", y1: "20", y2: "20" }],
])

export const StrikethroughIcon = createIcon([
	["path", { d: "M16 4H9a3 3 0 0 0-2.83 4" }],
	["path", { d: "M14 12a4 4 0 0 1 0 8H6" }],
	["line", { x1: "4", x2: "20", y1: "12", y2: "12" }],
])

export const Heading1Icon = createIcon([
	["path", { d: "M4 12h8" }],
	["path", { d: "M4 18V6" }],
	["path", { d: "M12 18V6" }],
	["path", { d: "m17 12 3-2v8" }],
])

export const Heading2Icon = createIcon([
	["path", { d: "M4 12h8" }],
	["path", { d: "M4 18V6" }],
	["path", { d: "M12 18V6" }],
	["path", { d: "M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1" }],
])

export const Heading3Icon = createIcon([
	["path", { d: "M4 12h8" }],
	["path", { d: "M4 18V6" }],
	["path", { d: "M12 18V6" }],
	["path", { d: "M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2" }],
	["path", { d: "M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2" }],
])

export const QuoteIcon = createIcon([
	[
		"path",
		{
			d: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
		},
	],
	[
		"path",
		{
			d: "M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z",
		},
	],
])

export const ListIcon = createIcon([
	["path", { d: "M3 5h.01" }],
	["path", { d: "M3 12h.01" }],
	["path", { d: "M3 19h.01" }],
	["path", { d: "M8 5h13" }],
	["path", { d: "M8 12h13" }],
	["path", { d: "M8 19h13" }],
])

export const ListOrderedIcon = createIcon([
	["path", { d: "M11 5h10" }],
	["path", { d: "M11 12h10" }],
	["path", { d: "M11 19h10" }],
	["path", { d: "M4 4h1v5" }],
	["path", { d: "M4 9h2" }],
	["path", { d: "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02" }],
])

export const CodeIcon = createIcon([
	["path", { d: "m16 18 6-6-6-6" }],
	["path", { d: "m8 6-6 6 6 6" }],
])

export const AlignLeftIcon = createIcon([
	["path", { d: "M21 5H3" }],
	["path", { d: "M15 12H3" }],
	["path", { d: "M17 19H3" }],
])

export const AlignCenterIcon = createIcon([
	["path", { d: "M21 5H3" }],
	["path", { d: "M17 12H7" }],
	["path", { d: "M19 19H5" }],
])

export const AlignRightIcon = createIcon([
	["path", { d: "M21 5H3" }],
	["path", { d: "M21 12H9" }],
	["path", { d: "M21 19H7" }],
])

export const IndentDecreaseIcon = createIcon([
	["path", { d: "M21 5H11" }],
	["path", { d: "M21 12H11" }],
	["path", { d: "M21 19H11" }],
	["path", { d: "m7 8-4 4 4 4" }],
])
