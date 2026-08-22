import { MAX_URL_LENGTH } from "@hoardodile/schemas"

import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
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
import { Link } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useEffect, useRef, useState } from "react"
import { useDocTheme } from "@/features/doc/hooks/useDocPrefs"
import type { DocEditorInstance } from "../schema.ts"

export type LinkToolbarButtonProps = {
	readonly label: string
	readonly prompt: string
	readonly disabled: boolean
	readonly editor: DocEditorInstance
}

export function LinkToolbarButton(props: LinkToolbarButtonProps) {
	const { label, prompt, disabled, editor } = props
	const { themeClass } = useDocTheme()
	const [open, setOpen] = useState(false)
	const [url, setUrl] = useState("")
	const inputRef = useRef<HTMLInputElement | null>(null)
	useEffect(() => {
		if (!open) return
		// Pre-populate with the URL of the link the cursor sits inside, if
		// any, so opening the popover acts as an "edit link" affordance.
		const existing = editor.getSelectedLinkUrl()
		setUrl(typeof existing === "string" ? existing : "")
		// Defer focus until the popover content is mounted.
		requestAnimationFrame(() => {
			inputRef.current?.focus()
			inputRef.current?.select()
		})
	}, [open, editor])
	function commit() {
		const trimmed = url.trim()
		if (trimmed.length === 0) return
		editor.createLink(trimmed)
		setOpen(false)
		editor.focus()
	}
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Toggle
									size="sm"
									pressed={false}
									disabled={disabled}
									aria-label={label}
									className="size-7 shrink-0 px-0"
								>
									<Link className="size-4" />
								</Toggle>
							}
						/>
					}
				/>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
			<PopoverContent
				align="start"
				className={cn("doc w-72 space-y-2 p-2", themeClass)}
			>
				<Input
					ref={inputRef}
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					maxLength={MAX_URL_LENGTH}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							commit()
						}
					}}
					placeholder={prompt}
					size="sm"
				/>
				<div className="flex justify-end">
					<Button
						type="button"
						size="sm"
						className="h-7"
						onClick={commit}
						disabled={url.trim().length === 0}
					>
						{label}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	)
}
