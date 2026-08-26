import { Skeleton } from "@hoardodile/ui/components/skeleton"
import type { CSSProperties, Ref } from "react"
import { memo } from "react"
import { DocStatusBar } from "@/features/doc/components/DocStatusBar"
import {
	DocEditor,
	type DocEditorHandle,
} from "@/features/doc/editor/DocEditor"

export type DocMainEditorProps = {
	readonly value: Record<string, unknown> | undefined
	readonly editable: boolean
	readonly placeholder?: string
	readonly onChange?: (content: Record<string, unknown>) => void
	readonly onHistoryChange?: (flags: {
		readonly canUndo: boolean
		readonly canRedo: boolean
	}) => void
	readonly onHeadingsChange?: (
		headings: {
			readonly id: string
			readonly level: number
			readonly text: string
		}[],
	) => void
	readonly onCharCountChange?: (count: number) => void
	readonly handleRef?: Ref<DocEditorHandle>
	readonly onReady?: () => (() => void) | undefined
}

export type DocDiffEditorProps = {
	readonly value: Record<string, unknown> | undefined
	readonly handleRef: Ref<DocEditorHandle>
	readonly onReady: () => (() => void) | undefined
}

export type DocEditorColumnProps = {
	readonly docId: string
	readonly zoom: number
	readonly indentEnabled: boolean
	readonly editorFontFamily: string | undefined
	readonly editorMounted: boolean
	/**
	 * Immersive reading view: the main editor is forced read-only and
	 * its change/history wiring is dropped so nothing can dirty the draft.
	 */
	readonly readingView: boolean
	readonly diffMode: boolean
	readonly mainEditor: DocMainEditorProps
	readonly diffEditor?: DocDiffEditorProps
	/** Rendered below the editor body in the normal view only. */
	readonly statusBar?: {
		readonly charCount: number
		readonly maxCharCount: number
		readonly offline: boolean
	}
}

/**
 * The document-flow editor column: a `data-doc-zoom-root` wrapper that
 * carries the zoom/indent/font CSS variables, a same-height skeleton
 * while the editor mount is deferred, the diff or main editor itself,
 * and the optional status bar. Shared by the normal and immersive
 * reading views so the CSS-variable boilerplate lives in one place.
 */
export const DocEditorColumn = memo(function DocEditorColumn(
	props: DocEditorColumnProps,
) {
	const {
		docId,
		zoom,
		indentEnabled,
		editorFontFamily,
		editorMounted,
		readingView,
		diffMode,
		mainEditor,
		diffEditor,
		statusBar,
	} = props

	return (
		<div
			data-doc-zoom-root
			data-doc-indent={indentEnabled ? "true" : "false"}
			data-doc-diff={diffMode ? "true" : "false"}
			className="flex-1"
			style={
				{
					"--doc-zoom": String(zoom),
					...(editorFontFamily
						? { "--font-doc-editor-body": editorFontFamily }
						: {}),
				} as CSSProperties
			}
		>
			{!editorMounted ? (
				// Same-height placeholder so the deferred editor mount does
				// not shift the layout when it lands. Transparent so the
				// loading area blends with the document background.
				<Skeleton className="min-h-[50svh] w-full bg-transparent" />
			) : diffMode && diffEditor !== undefined ? (
				diffEditor.value !== undefined ? (
					<DocEditor
						key={`${docId}-diff`}
						value={diffEditor.value}
						editable={false}
						handleRef={diffEditor.handleRef}
						onReady={diffEditor.onReady}
					/>
				) : (
					// The twin editor captures `initialContent` at mount,
					// so it mounts only once the selected version's
					// content is actually available — mounting empty and
					// relying on the later diff apply would leave a blank
					// compare view on any failure.
					<Skeleton className="min-h-[50svh] w-full bg-transparent" />
				)
			) : (
				<DocEditor
					key={docId}
					value={mainEditor.value}
					editable={readingView ? false : mainEditor.editable}
					placeholder={readingView ? undefined : mainEditor.placeholder}
					onChange={readingView ? undefined : mainEditor.onChange}
					onHistoryChange={readingView ? undefined : mainEditor.onHistoryChange}
					onHeadingsChange={mainEditor.onHeadingsChange}
					onCharCountChange={mainEditor.onCharCountChange}
					handleRef={mainEditor.handleRef}
					onReady={mainEditor.onReady}
				/>
			)}
			{!diffMode && !readingView && statusBar !== undefined && (
				<DocStatusBar
					charCount={statusBar.charCount}
					maxCharCount={statusBar.maxCharCount}
					offline={statusBar.offline}
				/>
			)}
		</div>
	)
})
