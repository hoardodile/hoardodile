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
import { PaletteRound } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ColorPicker } from "@/components/common/ColorPicker"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"

export type ColorPickerToolbarButtonProps = {
	readonly label: string
	readonly current: string | undefined
	readonly disabled: boolean
	readonly onPick: (color: string) => void
}

export function ColorPickerToolbarButton(props: ColorPickerToolbarButtonProps) {
	const { label, current, disabled, onPick } = props
	const { t } = useTranslation()
	const { themeClass } = useDocTheme()
	const [open, setOpen] = useState(false)
	return (
		<Popover open={open} onOpenChange={setOpen}>
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
									<PaletteRound className="size-4" />
								</Toggle>
							}
						/>
					}
				/>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="start"
				className={cn("doc w-auto p-3", themeClass)}
			>
				<ColorPicker
					value={current ?? ""}
					onChange={(color) => {
						onPick(color)
						setOpen(false)
					}}
					specialStyles={false}
					placeholder={t("common.colorPicker.customColor")}
				/>
			</PopoverContent>
		</Popover>
	)
}
