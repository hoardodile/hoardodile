import { BlockNoteEditor } from "@blocknote/core"
import { BlockNoteView } from "@blocknote/shadcn"
import { act, render } from "@testing-library/react"
import { expect, it } from "vitest"
import { applyDiffDoc, computeInlineDiffDoc } from "../diffCompute.ts"
import { docDiffExtension } from "./docDiffExtension.ts"
import { docSchema } from "./schema.ts"

it.each(["paragraph", "codeBlock"])(
	"renders %s changes in the read-only editor",
	(type) => {
		const editor = BlockNoteEditor.create({
			schema: docSchema,
			extensions: [docDiffExtension()],
		})
		const { container, unmount } = render(
			<BlockNoteView editor={editor} editable={false} />,
		)
		try {
			const diff = computeInlineDiffDoc(
				editor,
				[{ type, content: "old text" }],
				[{ type, content: "new text" }],
			)
			expect(diff).toBeDefined()
			act(() => applyDiffDoc(editor, diff!))
			expect(container.querySelector("del")?.textContent).toBe("old")
			expect(container.querySelector("ins")?.textContent).toBe("new")
			expect(
				container.querySelector('[contenteditable="false"]'),
			).not.toBeNull()
		} finally {
			unmount()
			editor._tiptapEditor.destroy()
		}
	},
)
