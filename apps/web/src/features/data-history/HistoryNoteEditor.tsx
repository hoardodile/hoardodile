import { Button } from "@hoardodile/ui/components/button"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export type HistoryNoteEditorProps = {
	readonly note?: string
	readonly onSave: (note: string) => void
	readonly disabled?: boolean
}

/**
 * Inline note editor for a backup or archive node. Shows a read-only preview
 * by default; clicking enters edit mode. Saves on blur or explicit submit.
 */
export function HistoryNoteEditor(props: HistoryNoteEditorProps) {
	const { note, onSave, disabled } = props
	const { t } = useTranslation()
	const [isEditing, setIsEditing] = useState(false)
	const [draft, setDraft] = useState(note ?? "")

	function startEditing() {
		setDraft(note ?? "")
		setIsEditing(true)
	}

	function commit() {
		const trimmed = draft.trim()
		onSave(trimmed)
		setIsEditing(false)
	}

	function cancel() {
		setDraft(note ?? "")
		setIsEditing(false)
	}

	if (isEditing) {
		return (
			<div className="flex flex-col gap-2">
				<Textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					placeholder={t("dataHistory.note.placeholder")}
					disabled={disabled}
					rows={2}
					className="min-h-[60px] resize-none"
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							cancel()
						}
					}}
				/>
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						onClick={commit}
						disabled={disabled}
						data-testid="note-save"
					>
						{t("common.save")}
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={cancel}
						disabled={disabled}
						data-testid="note-cancel"
					>
						{t("common.cancel")}
					</Button>
				</div>
			</div>
		)
	}

	return (
		<button
			type="button"
			onClick={startEditing}
			disabled={disabled}
			className="group w-full text-left"
			data-testid="note-preview"
		>
			{note !== undefined && note.length > 0 ? (
				<p className="text-sm text-foreground group-hover:text-primary transition-colors">
					{note}
				</p>
			) : (
				<p className="text-sm text-muted-foreground italic group-hover:text-foreground transition-colors">
					{t("dataHistory.note.empty")}
				</p>
			)}
		</button>
	)
}
