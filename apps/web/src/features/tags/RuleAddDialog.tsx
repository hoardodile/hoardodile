import type { CatKind } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { TagChip } from "@hoardodile/ui/components/tag-chip"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { CharChip } from "@/features/char/components/CharChip"
import { CharSearch } from "@/features/char/components/CharSearch"
import { useCharactersByIds } from "@/features/char/components/CharSelectorDialog"
import type { RuleEndpoint } from "./RuleEndpointPicker"
import { useTagsById } from "./TagSinglePicker"

export type RuleAddDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly title: string
	/** The editor's one-line instruction — the foolproof guide. */
	readonly description: string
	/** The leading slot (synonym / child) — a tag or a character. */
	readonly endpointLabel: string
	/** The trailing slot (display tag / parent) — a tag. */
	readonly tagLabel: string
	/** Whether the leading slot may pick a character (kind tab
	    character/common). */
	readonly allowCharacters: boolean
	readonly kind: CatKind
	/** Test-id prefixes of the two embedded pickers. */
	readonly endpointTestId: string
	readonly tagTestId: string
	/** Preset for the trailing slot when opened from a row's More menu. */
	readonly tagPreset?: string
	readonly confirmLabel: string
	readonly confirmTestId?: string
	readonly contentTestId?: string
	/** Mutation in flight — the confirm button waits and the dialog only
	    closes on success (the caller flips `open`). */
	readonly pending: boolean
	readonly onConfirm: (endpoint: RuleEndpoint, tagId: string) => void
}

/**
 * The rule editors — one big dialog per zone, no nested dialogs: the
 * embedded pickers (the category-tag picker and the character search)
 * render right in the body. One picker at a time: the leading slot
 * (synonym / child) first — a tag or a character, switched with a
 * segment — then, on pick, the trailing slot (display tag / parent).
 * The second step leads with the picked endpoint as a summary chip and
 * a Back button, and its tag may come pre-filled from a row's More
 * menu. The footer's confirm stays disabled until both slots are
 * filled.
 */
export function RuleAddDialog(props: RuleAddDialogProps) {
	const {
		open,
		onOpenChange,
		title,
		description,
		endpointLabel,
		tagLabel,
		allowCharacters,
		kind,
		endpointTestId,
		tagTestId,
		tagPreset,
		confirmLabel,
		confirmTestId,
		contentTestId,
		pending,
		onConfirm,
	} = props
	const { t } = useTranslation()
	const [phase, setPhase] = useState<"endpoint" | "tag">("endpoint")
	const [endpointKind, setEndpointKind] = useState<"tag" | "character">("tag")
	const [endpoint, setEndpoint] = useState<RuleEndpoint | null>(null)
	const [tagId, setTagId] = useState("")
	// Every open starts from the presets — stale picks never leak into
	// the next edit.
	const wasOpenRef = useRef(false)
	if (open && !wasOpenRef.current) {
		wasOpenRef.current = true
		setPhase("endpoint")
		setEndpointKind("tag")
		setEndpoint(null)
		setTagId(tagPreset ?? "")
	} else if (!open) {
		wasOpenRef.current = false
	}

	const tagsById = useTagsById()
	const selectedCharId =
		endpoint?.kind === "character" ? endpoint.id : undefined
	const { data: selectedChars } = useCharactersByIds(
		selectedCharId !== undefined ? [selectedCharId] : [],
	)
	const selectedChar = selectedChars?.find((c) => c.id === selectedCharId)

	const ready = endpoint !== null && tagId.length > 0

	function handleOpenChange(next: boolean) {
		if (!next) onOpenChange(false)
	}

	function handleConfirm() {
		if (endpoint === null || ready === false || pending) return
		onConfirm(endpoint, tagId)
	}

	/** Picking the leading slot moves straight to the trailing one. */
	function handleEndpointPick(endpoint: RuleEndpoint) {
		setEndpoint(endpoint)
		setPhase("tag")
	}

	function handleTagPick(id: string) {
		setTagId(id)
	}

	const selectedTag = tagId !== "" ? tagsById.get(tagId) : undefined
	const endpointChip =
		endpoint === null ? null : (
			<div className="flex flex-wrap items-center gap-1.5">
				{endpoint.kind === "character" ? (
					<CharChip
						charId={endpoint.id}
						character={selectedChar}
						showName
						disableLink
					/>
				) : (
					<TagChip color={tagsById.get(endpoint.id)?.color ?? ""}>
						{tagsById.get(endpoint.id)?.name ?? endpoint.id}
					</TagChip>
				)}
			</div>
		)

	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			title={title}
			description={description}
			size="2xl"
			contentTestId={contentTestId}
			footer={
				<>
					<Button
						type="button"
						variant="secondary"
						onClick={() => handleOpenChange(false)}
					>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						disabled={ready === false || pending}
						onClick={handleConfirm}
						data-testid={confirmTestId}
					>
						{confirmLabel}
					</Button>
				</>
			}
		>
			{phase === "endpoint" ? (
				/* Step one — the leading slot: a tag or a character. */
				<div className="flex min-w-0 flex-col gap-2">
					<SectionLabel tone="foreground">{endpointLabel}</SectionLabel>
					{endpointChip}
					{allowCharacters ? (
						<PillTabs
							value={endpointKind}
							onChange={setEndpointKind}
							className="self-start"
							items={[
								{
									value: "tag",
									label: t("tags.rules.endpointTag"),
									testId: `${endpointTestId}-tab-tag`,
								},
								{
									value: "character",
									label: t("tags.rules.endpointCharacter"),
									testId: `${endpointTestId}-tab-character`,
								},
							]}
						/>
					) : null}
					{endpointKind === "tag" ? (
						<DualTagPicker
							value={endpoint?.kind === "tag" ? [endpoint.id] : []}
							onChange={(ids) => {
								const id = ids[0]
								if (id !== undefined) {
									handleEndpointPick({ kind: "tag", id })
								}
							}}
							kind={kind}
							single
							collapseSiblings={false}
							testId={endpointTestId}
						/>
					) : (
						<CharSearch
							selection={{
								mode: "single",
								selected: selectedCharId,
								onChange: (id) => handleEndpointPick({ kind: "character", id }),
							}}
						/>
					)}
				</div>
			) : (
				/* Step two — the trailing slot, led by the picked endpoint
				    and a Back button; a preset tag may already be filled. */
				<div className="flex min-w-0 flex-col gap-2">
					<div className="flex flex-wrap items-center gap-2">
						{endpointChip}
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className="h-6 px-2"
							onClick={() => setPhase("endpoint")}
							data-testid={`${endpointTestId}-back`}
						>
							{t("common.back")}
						</Button>
					</div>
					<SectionLabel tone="foreground">{tagLabel}</SectionLabel>
					{tagId !== "" ? (
						<div className="flex flex-wrap items-center gap-1.5">
							<TagChip
								color={selectedTag?.color ?? ""}
								border={selectedTag === undefined ? "dashed" : undefined}
							>
								{selectedTag?.name ?? tagId}
							</TagChip>
						</div>
					) : null}
					<DualTagPicker
						value={tagId !== "" ? [tagId] : []}
						onChange={(ids) => {
							const id = ids[0]
							if (id !== undefined) handleTagPick(id)
						}}
						kind={kind}
						single
						collapseSiblings={false}
						testId={tagTestId}
					/>
				</div>
			)}
		</AppDialog>
	)
}
