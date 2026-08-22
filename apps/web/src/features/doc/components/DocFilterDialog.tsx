import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CharChipsPicker } from "@/features/char/components/CharChipsPicker"
import { ResChipsPicker } from "@/features/res/components/ResChipsPicker"

export type DocFilterDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly charIds: readonly string[]
	readonly resIds: readonly string[]
	readonly onApply: (
		charIds: readonly string[],
		resIds: readonly string[],
	) => void
}

/**
 * The documents filter dialog: pick characters and resources (the same
 * chip rows + selector dialogs the comment composer uses) to scope the
 * document listing. Edits stay local until Apply; Clear empties the
 * draft and Apply commits both back to the URL.
 */
export function DocFilterDialog(props: DocFilterDialogProps) {
	const { open, onOpenChange, charIds, resIds, onApply } = props
	const { t } = useTranslation()
	const initialKey = `${charIds.join(",")}\u0000${resIds.join(",")}`
	const [openKey, setOpenKey] = useState(initialKey)
	const [draft, setDraft] = useState<{
		readonly charIds: readonly string[]
		readonly resIds: readonly string[]
	}>({ charIds, resIds })

	// Resync the draft when the dialog re-opens with fresh URL filters.
	if (open && openKey !== initialKey) {
		setOpenKey(initialKey)
		setDraft({ charIds, resIds })
	}

	function handleClose() {
		onOpenChange(false)
	}

	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) handleClose()
			}}
			title={t("documents.filter.dialogTitle")}
			size="lg"
			footer={
				<>
					{/* Three-button footer (DESIGN.md — Overlays): the secondary
					    function key (clear) sits at the left edge; cancel and
					    the primary action (apply) stay right-aligned. */}
					<Button
						type="button"
						variant="secondary"
						className="mr-auto"
						onClick={() => setDraft({ charIds: [], resIds: [] })}
						data-testid="doc-filter-clear"
					>
						{t("documents.filter.clear")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={handleClose}
						data-testid="doc-filter-cancel"
					>
						{t("common.cancel")}
					</Button>
					<Button
						type="button"
						onClick={() => {
							handleClose()
							onApply(draft.charIds, draft.resIds)
						}}
						data-testid="doc-filter-apply"
					>
						{t("documents.filter.apply")}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<SectionLabel>{t("characters.title")}</SectionLabel>
					<CharChipsPicker
						ids={draft.charIds}
						onChange={(ids) => setDraft((d) => ({ ...d, charIds: ids }))}
						testId="doc-filter-characters"
					/>
				</div>
				<div className="flex flex-col gap-2">
					<SectionLabel>{t("overview.stats.resources")}</SectionLabel>
					<ResChipsPicker
						ids={draft.resIds}
						onChange={(ids) => setDraft((d) => ({ ...d, resIds: ids }))}
						testId="doc-filter-resources"
					/>
				</div>
			</div>
		</AppDialog>
	)
}
