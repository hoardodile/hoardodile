import type { Character } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { useTranslation } from "react-i18next"
import { useEditHubSectionTitle } from "@/components/common/useEditHubSectionTitle"
import { invalidateCharacters } from "../api"
import { CharactershipPanel } from "./CharactershipPanel"
import { CharEditPanel } from "./CharEditPanel"
import { CharImagePanel, type CharImageVariant } from "./CharImagePanel"
import { CharTraitValuesPanel } from "./CharTraitValuesPanel"

/**
 * Standalone edit dialogs for a character, opened from the card actions
 * submenu. They share a private shell for the title + AppDialog wiring
 * and only specialise the inner panel.
 */

// ── CharSectionDialog (merged) ───────────────────────────────────────────────

function useSectionTitle(charName: string, sectionKey: string): string {
	return useEditHubSectionTitle({
		hubKey: "characters.editHub.title",
		name: charName,
		sectionKey,
	})
}

function CharSectionDialog(props: {
	readonly open: boolean
	readonly charName: string
	readonly sectionKey: string
	readonly contentClassName?: string
	readonly onOpenChange: (open: boolean) => void
	readonly children: ReactNode
}) {
	const {
		open,
		charName,
		sectionKey,
		contentClassName,
		onOpenChange,
		children,
	} = props
	const title = useSectionTitle(charName, sectionKey)
	const { t } = useTranslation()
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			contentClassName={contentClassName}
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			{children}
		</AppDialog>
	)
}

// ── Exported dialog wrappers ─────────────────────────────────────────────────

export type CharBasicEditDialogProps = {
	readonly open: boolean
	readonly character: Character
	readonly onOpenChange: (open: boolean) => void
}

export function CharBasicEditDialog(props: CharBasicEditDialogProps) {
	const { open, character, onOpenChange } = props
	return (
		<CharSectionDialog
			open={open}
			charName={character.name}
			sectionKey="characters.actions.editBasic"
			contentClassName="sm:max-w-2xl"
			onOpenChange={onOpenChange}
		>
			<CharEditPanel
				character={character}
				onSaved={() => onOpenChange(false)}
			/>
		</CharSectionDialog>
	)
}

export type CharTraitsEditDialogProps = {
	readonly open: boolean
	readonly character: Character
	readonly onOpenChange: (open: boolean) => void
}

export function CharTraitsEditDialog(props: CharTraitsEditDialogProps) {
	const { open, character, onOpenChange } = props
	return (
		<CharSectionDialog
			open={open}
			charName={character.name}
			sectionKey="characters.actions.editTraits"
			contentClassName="sm:max-w-3xl"
			onOpenChange={onOpenChange}
		>
			<CharTraitValuesPanel
				charId={character.id}
				traitValues={character.traitValues ?? {}}
				onSaved={() => onOpenChange(false)}
			/>
		</CharSectionDialog>
	)
}

export type CharImageEditDialogProps = {
	readonly open: boolean
	readonly charId: string
	readonly charName: string
	readonly variant: CharImageVariant
	readonly onOpenChange: (open: boolean) => void
}

export function CharImageEditDialog(props: CharImageEditDialogProps) {
	const { open, charId, charName, variant, onOpenChange } = props
	const sectionKey =
		variant === "avatar"
			? "characters.actions.editAvatar"
			: "characters.actions.editFullbody"
	return (
		<CharSectionDialog
			open={open}
			charName={charName}
			sectionKey={sectionKey}
			contentClassName="sm:max-w-2xl"
			onOpenChange={onOpenChange}
		>
			<CharImagePanel
				charId={charId}
				variant={variant}
				onSaved={() => onOpenChange(false)}
			/>
		</CharSectionDialog>
	)
}

export type CharRelationsEditDialogProps = {
	readonly open: boolean
	readonly character: Character
	readonly onOpenChange: (open: boolean) => void
}

export function CharRelationsEditDialog(props: CharRelationsEditDialogProps) {
	const { open, character, onOpenChange } = props
	const qc = useQueryClient()
	const [dirty, setDirty] = useState(false)

	function handleOpenChange(next: boolean) {
		if (!next) {
			if (dirty) {
				invalidateCharacters(qc, character.id)
			}
			setDirty(false)
		}
		onOpenChange(next)
	}

	return (
		<CharSectionDialog
			open={open}
			charName={character.name}
			sectionKey="characters.actions.editRelations"
			contentClassName="sm:max-w-3xl"
			onOpenChange={handleOpenChange}
		>
			<CharactershipPanel
				open={open}
				charId={character.id}
				charName={character.name}
				charUpdatedAt={character.updatedAt}
				onSaved={() => setDirty(true)}
			/>
		</CharSectionDialog>
	)
}
