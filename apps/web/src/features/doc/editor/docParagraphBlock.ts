import type { PropSchema } from "@blocknote/core"
import {
	addDefaultPropsExternalHTML,
	createBlockConfig,
	createBlockSpec,
	createExtension,
	defaultProps,
	parseDefaultProps,
} from "@blocknote/core"

/**
 * Paragraph props from BlockNote defaults plus per-block control for the
 * document-level Chinese first-line indent (`text-indent`), controlled via CSS.
 * `indent` defaults to true; set false to opt out for a single paragraph.
 */
export const docParagraphPropSchema = {
	...defaultProps,
	indent: { default: true },
} satisfies PropSchema

export type DocParagraphProps = import("@blocknote/core").Props<
	typeof docParagraphPropSchema
>

export const createDocParagraphBlockConfig = createBlockConfig(
	() =>
		({
			type: "paragraph" as const,
			propSchema: docParagraphPropSchema,
			content: "inline" as const,
		}) as const,
)

export const createDocParagraphBlockSpec = createBlockSpec(
	createDocParagraphBlockConfig,
	{
		meta: {
			isolating: false,
		},
		parse: (e) => {
			if (e.tagName !== "P") {
				return undefined
			}

			if (!e.textContent?.trim()) {
				return undefined
			}

			const base = parseDefaultProps(e)
			return {
				...base,
				indent: e.getAttribute("data-indent") !== "false",
			}
		},
		render: () => {
			const dom = document.createElement("p")
			return {
				dom,
				contentDOM: dom,
			}
		},
		toExternalHTML: (block) => {
			const dom = document.createElement("p")
			addDefaultPropsExternalHTML(block.props, dom)
			return {
				dom,
				contentDOM: dom,
			}
		},
		runsBefore: ["default", "heading"],
	},
	[
		createExtension({
			key: "paragraph-shortcuts",
			keyboardShortcuts: {
				"Mod-Alt-0": ({ editor }) => {
					const cursorPosition = editor.getTextCursorPosition()

					if (
						editor.schema.blockSchema[cursorPosition.block.type].content !==
						"inline"
					) {
						return false
					}

					editor.updateBlock(cursorPosition.block, {
						type: "paragraph",
						props: {},
					})
					return true
				},
			},
		}),
	],
)
