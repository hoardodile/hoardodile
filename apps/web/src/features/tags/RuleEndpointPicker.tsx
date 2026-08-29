import type { CatKind } from "@hoardodile/schemas"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { TagChip } from "@hoardodile/ui/components/tag-chip"
import { AltArrowDown } from "@hoardodile/ui/icons/registry"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { CharChip } from "@/features/char/components/CharChip"
import {
	CharSelectorDialog,
	useCharactersByIds,
} from "@/features/char/components/CharSelectorDialog"
import { TagPickDialog } from "./TagPickDialog"
import { useTagsById } from "./TagSinglePicker"

/** A rule endpoint: a tag or a character entity. */
export type RuleEndpoint = {
	readonly kind: "tag" | "character"
	readonly id: string
}

export type RuleEndpointPickerProps = {
	readonly value: RuleEndpoint | null
	readonly onChange: (endpoint: RuleEndpoint) => void
	/**
	 * When `true` (and the tab is `character` or `common`), the trigger's
	 * menu offers characters — character entities count as `character`
	 * kind for rule isolation, so they only join those kinds.
	 */
	readonly allowCharacters: boolean
	readonly kind: CatKind
	readonly placeholder: string
	readonly testId?: string
}

/**
 * Single-select rule endpoint picker. The trigger opens the shared tag
 * dialog ({@link TagPickDialog}) directly; when characters may join the
 * rule, it opens a menu first — Character… → the shared character
 * selector dialog ({@link CharSelectorDialog}), Tag… → the tag dialog.
 */
export function RuleEndpointPicker(props: RuleEndpointPickerProps) {
	const { value, onChange, allowCharacters, kind, placeholder, testId } = props
	const { t } = useTranslation()
	const [menuOpen, setMenuOpen] = useState(false)
	const [tagOpen, setTagOpen] = useState(false)
	const [charOpen, setCharOpen] = useState(false)
	const tagsById = useTagsById()

	const showCharacters =
		allowCharacters && (kind === "character" || kind === "common")
	const selectedTag = value?.kind === "tag" ? tagsById.get(value.id) : undefined
	const selectedCharId = value?.kind === "character" ? value.id : undefined
	const { data: selectedChars } = useCharactersByIds(
		selectedCharId !== undefined ? [selectedCharId] : [],
	)
	const selectedChar = useMemo(
		() => selectedChars?.find((c) => c.id === selectedCharId),
		[selectedChars, selectedCharId],
	)

	function triggerButton(onClick: (() => void) | undefined) {
		return (
			<button
				type="button"
				onClick={onClick}
				className="inline-flex h-chip w-fit max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-muted px-2.5 text-xs text-secondary-foreground outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-accent active:bg-accent data-placeholder:text-muted-foreground"
				data-placeholder={value === null ? true : undefined}
				data-testid={testId}
			>
				{value === null ? (
					<span className="line-clamp-1">{placeholder}</span>
				) : value.kind === "character" ? (
					<CharChip charId={value.id} character={selectedChar} disableLink />
				) : selectedTag !== undefined ? (
					<TagChip color={selectedTag.color}>{selectedTag.name}</TagChip>
				) : (
					<span className="line-clamp-1">{value.id}</span>
				)}
				<AltArrowDown
					className="pointer-events-none size-4 shrink-0 text-muted-foreground"
					aria-hidden
				/>
			</button>
		)
	}

	return (
		<>
			{showCharacters ? (
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger render={triggerButton(undefined)} />
					<DropdownMenuContent align="start" className="min-w-36">
						<DropdownMenuItem
							onClick={() => {
								setMenuOpen(false)
								setCharOpen(true)
							}}
							data-testid={`${testId}-pick-character`}
						>
							{t("tags.rules.pickCharacter")}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								setMenuOpen(false)
								setTagOpen(true)
							}}
							data-testid={`${testId}-pick-tag`}
						>
							{t("tags.rules.pickTag")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				triggerButton(() => setTagOpen(true))
			)}
			<TagPickDialog
				open={tagOpen}
				onOpenChange={setTagOpen}
				kind={kind}
				onPick={(id) => onChange({ kind: "tag", id })}
				testId={testId}
			/>
			<CharSelectorDialog
				open={charOpen}
				mode="single"
				onSelect={(id) => {
					onChange({ kind: "character", id })
					setCharOpen(false)
				}}
				onOpenChange={setCharOpen}
				confirmTestId={`${testId}-char-confirm`}
			/>
		</>
	)
}
