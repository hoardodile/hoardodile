import type { CatKind } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { DualTagPicker } from "@/components/common/DualTagPicker"

export type TagPickDialogProps = {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	/** Only categories of this kind (plus `common`) are offered. */
	readonly kind?: CatKind
	readonly onPick: (tagId: string) => void
	readonly testId?: string
}

/**
 * Single-select tag dialog for rule setup: the shared category-tag
 * picker ({@link DualTagPicker} in single mode) without sibling
 * collapse — rules must reference the real tags, not their display
 * tags. Clicking a tag commits and closes (the popover it replaces
 * behaved the same way).
 */
export function TagPickDialog(props: TagPickDialogProps) {
	const { open, onOpenChange, kind, onPick, testId } = props
	const { t } = useTranslation()
	const [picked, setPicked] = useState<string | undefined>(undefined)

	function handleOpenChange(next: boolean) {
		if (!next) {
			setPicked(undefined)
			onOpenChange(false)
		}
	}

	function handlePick(tagId: string) {
		setPicked(tagId)
		onOpenChange(false)
		onPick(tagId)
	}

	return (
		<AppDialog
			open={open}
			onOpenChange={handleOpenChange}
			title={t("tags.rules.tagPickTitle")}
			size="lg"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => handleOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<DualTagPicker
				value={picked !== undefined ? [picked] : []}
				onChange={(ids) => {
					const tagId = ids[0]
					if (tagId !== undefined) handlePick(tagId)
				}}
				kind={kind}
				single
				collapseSiblings={false}
				testId={testId}
			/>
		</AppDialog>
	)
}
