import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { Pen } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useState } from "react"
import { useTranslation } from "react-i18next"

export type InlineNameEditorProps = {
	readonly name: string
	readonly onSave: (name: string) => void
	readonly disabled?: boolean
	readonly placeholder?: string
	readonly label?: string
}

/**
 * Inline display-name editor. Shows the current name with an edit hint on
 * hover; clicking enters edit mode. Saves on Enter/blur, cancels on Escape.
 */
export function InlineNameEditor(props: InlineNameEditorProps) {
	const { name, onSave, disabled, placeholder, label } = props
	const { t } = useTranslation()
	const [isEditing, setIsEditing] = useState(false)
	const [draft, setDraft] = useState(name)

	function startEditing() {
		setDraft(name)
		setIsEditing(true)
	}

	function commit() {
		const trimmed = draft.trim()
		if (trimmed !== name) {
			onSave(trimmed)
		}
		setIsEditing(false)
	}

	function cancel() {
		setDraft(name)
		setIsEditing(false)
	}

	if (isEditing) {
		return (
			<div className="flex items-center gap-2">
				{label !== undefined ? (
					<span className="text-xs text-muted-foreground">{label}</span>
				) : null}
				<Input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					placeholder={placeholder}
					disabled={disabled}
					autoFocus
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							commit()
						} else if (e.key === "Escape") {
							cancel()
						}
					}}
					size="sm"
					data-testid="name-input"
				/>
				<Button
					size="sm"
					onClick={commit}
					disabled={disabled}
					data-testid="name-save"
				>
					{t("common.save")}
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={cancel}
					disabled={disabled}
					data-testid="name-cancel"
				>
					{t("common.cancel")}
				</Button>
			</div>
		)
	}

	return (
		<button
			type="button"
			onClick={startEditing}
			disabled={disabled}
			className="group flex w-full items-center gap-2 text-left"
			data-testid="name-preview"
		>
			{label !== undefined ? (
				<span className="text-xs text-muted-foreground">{label}</span>
			) : null}
			<span
				className={cn(
					"truncate text-sm group-hover:text-primary transition-colors",
					name.length > 0 ? "font-medium" : "text-muted-foreground italic",
				)}
			>
				{name.length > 0 ? name : placeholder}
			</span>
			<Pen className="size-3 opacity-0 text-muted-foreground transition-opacity group-hover:opacity-70" />
		</button>
	)
}
