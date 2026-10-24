import { createExtension } from "@blocknote/core"
import {
	deletion,
	insertion,
	modification,
} from "@handlewithcare/prosemirror-suggest-changes"
import { Mark } from "@tiptap/core"

/** Keep the read-only diff schema independent of BlockNote's AI/Yjs marks. */
export const docDiffExtension = createExtension(() => ({
	key: "docDiff",
	tiptapExtensions: Object.entries({ insertion, deletion, modification }).map(
		([name, spec]) =>
			Mark.create({
				name,
				group: "blockLevelSuggestion annotation",
				extendMarkSchema: (extension) =>
					extension.name === name ? { blocknoteIgnore: true } : {},
				inclusive: spec.inclusive,
				excludes: spec.excludes,
				addAttributes: () =>
					Object.fromEntries(
						Object.entries(spec.attrs ?? {}).map(([key, attr]) => [
							key,
							{ default: attr.default ?? null },
						]),
					),
				parseHTML: () => spec.parseDOM ?? [],
				renderHTML: ({ mark }) => spec.toDOM!(mark, true),
			}),
	),
}))
