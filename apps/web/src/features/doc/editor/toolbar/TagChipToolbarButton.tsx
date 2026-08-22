import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { Toggle } from "@hoardodile/ui/components/toggle"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { Tag } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ColorPicker } from "@/components/common/ColorPicker"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"

export type TagChipToolbarButtonProps = {
	readonly label: string
	readonly current: string | undefined
	readonly disabled: boolean
	readonly onPick: (color: string) => void
}

/**
 * Toolbar button that applies or removes the `tagChip` inline node.
 *
 * - Selecting text and picking a color wraps the selection in a chip.
 * - Selecting an existing chip and picking a color updates its color.
 * - Clearing the color removes the chip and restores its text as plain text.
 */
export function TagChipToolbarButton(props: TagChipToolbarButtonProps) {
	const { label, current, disabled, onPick } = props
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	const [open, setOpen] = useState(false)
	const [color, setColor] = useState("")

	function handleOpenChange(nextOpen: boolean) {
		setOpen(nextOpen)
		if (nextOpen) {
			setColor(current ?? "")
		}
	}

	function handlePick(nextColor: string) {
		setColor(nextColor)
		onPick(nextColor)
		setOpen(false)
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Toggle
									size="sm"
									pressed={current !== undefined && current !== ""}
									disabled={disabled}
									aria-label={label}
									className="size-7 shrink-0 px-0"
								>
									<Tag className="size-4" />
								</Toggle>
							}
						/>
					}
				/>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className={cn("doc w-80 p-3", themeClass)}>
				<ColorPicker
					value={color}
					onChange={handlePick}
					placeholder={t("common.colorPicker.customColor")}
				/>
			</PopoverContent>
		</Popover>
	)
}
