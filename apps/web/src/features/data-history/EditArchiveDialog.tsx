import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { ArchiveEvent } from "./api"

export type EditArchiveDialogProps = {
	readonly archive: ArchiveEvent | null
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly onSave: (patch: {
		readonly name: string
		readonly note: string
	}) => void
	readonly pending: boolean
}

/**
 * Name + description editor for the current (writable) archive — the
 * only version the server lets the caller change.
 */
export function EditArchiveDialog(props: EditArchiveDialogProps) {
	const { archive, open, onOpenChange, onSave, pending } = props
	const { t } = useTranslation()
	const [name, setName] = useState("")
	const [note, setNote] = useState("")

	useEffect(() => {
		if (!open || archive === null) return
		setName(archive.name ?? "")
		setNote(archive.note ?? "")
	}, [open, archive])

	const target = archive
	const footer = (
		<>
			<Button
				variant="secondary"
				onClick={() => onOpenChange(false)}
				disabled={pending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				onClick={() => {
					onSave({ name: name.trim(), note: note.trim() })
					onOpenChange(false)
				}}
				disabled={pending || target === null}
				data-testid="archive-meta-save"
			>
				{t("common.save")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("dataHistory.edit.title")}
			description={
				target === null
					? undefined
					: t("dataHistory.edit.description", { version: target.version })
			}
			footer={footer}
			contentTestId="archive-meta-dialog"
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="archive-meta-name">
						{t("dataHistory.archive.nameLabel")}
					</Label>
					<Input
						id="archive-meta-name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder={t("dataHistory.archive.namePlaceholder")}
						disabled={pending}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="archive-meta-note">
						{t("dataHistory.archive.noteLabel")}
					</Label>
					<Textarea
						id="archive-meta-note"
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder={t("dataHistory.archive.notePlaceholder")}
						rows={3}
						className="min-h-[80px] resize-none"
						disabled={pending}
					/>
				</div>
			</div>
		</AppDialog>
	)
}
