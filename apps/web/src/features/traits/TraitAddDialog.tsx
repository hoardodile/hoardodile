import type { EntityMetaDraft, TraitKind } from "@hoardodile/schemas"
import { MAX_TRAIT_NAME_LENGTH, TRAIT_KINDS } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { EntityMetaFields } from "@/components/common/EntityMetaFields"
import { useDelayedReset } from "@/hooks/useDelayedReset"
import { useSaveMutation } from "@/hooks/useSaveMutation"
import {
	buildEntityMetaCreatePayload,
	emptyEntityMetaDraft,
} from "@/lib/entityMetaDraft"
import { createTraitMutation, invalidateTraits } from "./api"

export function isTraitKind(value: string): value is TraitKind {
	for (const k of TRAIT_KINDS) {
		if (k === value) return true
	}
	return false
}

/**
 * Create-trait dialog — shared by the custom page's Traits tab and the
 * character search's trait filter quick-add.
 */
export function TraitAddDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { open, onOpenChange } = props
	const { t } = useTranslation()
	const [draft, setDraft] = useState<EntityMetaDraft>(emptyEntityMetaDraft())
	const [kind, setKind] = useState<TraitKind>("text")
	const delayedReset = useDelayedReset()

	function resetForm() {
		setDraft(emptyEntityMetaDraft())
		setKind("text")
	}

	function handleOpenChange(nextOpen: boolean) {
		onOpenChange(nextOpen)
		if (!nextOpen) {
			delayedReset.schedule(resetForm)
		} else {
			delayedReset.cancel()
		}
	}

	const createMut = useSaveMutation({
		mutationOptions: createTraitMutation(),
		invalidate: invalidateTraits,
		onSaved: () => handleOpenChange(false),
		successMessageKey: "traits.panel.toast.added",
	})

	function handleSave() {
		const meta = buildEntityMetaCreatePayload({
			...draft,
			color: draft.color.trim(),
			intro: draft.intro.trim(),
		})
		if (meta === undefined) return
		createMut.mutate({
			...meta,
			kind,
		})
	}

	const footer = (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => handleOpenChange(false)}
				disabled={createMut.isPending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				onClick={handleSave}
				disabled={createMut.isPending || draft.name.trim().length === 0}
				data-testid="trait-add-submit"
			>
				{createMut.isPending ? t("common.saving") : t("me.custom.add")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			title={t("traits.panel.addDialogTitle")}
			footer={footer}
		>
			<div className="flex flex-col gap-3">
				<EntityMetaFields
					value={draft}
					onChange={(patch) => setDraft({ ...draft, ...patch })}
					maxNameLength={MAX_TRAIT_NAME_LENGTH}
					disabled={createMut.isPending}
					testIdPrefix="trait-add"
					nameTestId="trait-add-name"
				/>
				<DropdownSelect
					value={kind}
					onValueChange={(next) => {
						if (isTraitKind(next)) setKind(next)
					}}
					modal={false}
					data-testid="trait-add-kind"
					options={[
						{ value: "text", label: t("traits.kind.text") },
						{ value: "number", label: t("traits.kind.number") },
						{ value: "multitext", label: t("traits.kind.multitext") },
						{ value: "weight", label: t("traits.kind.weight") },
						{ value: "height", label: t("traits.kind.height") },
						{ value: "date", label: t("traits.kind.date") },
					]}
				/>
			</div>
		</AppDialog>
	)
}
