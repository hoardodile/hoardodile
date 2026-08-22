import { Input } from "@hoardodile/ui/components/input"
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { useEffect, useState } from "react"
import { useTranslation } from "./i18n"

/**
 * "3 / 24" badge that opens a jump-to-index field. The draft is seeded
 * from the live index each time the popover opens, so it never shows a
 * stale number after keyboard or tap navigation.
 */
export type GalleryJumpBadgeProps = {
	readonly index: number
	readonly count: number
	readonly onJump: (index: number) => void
}

export function GalleryJumpBadge(props: GalleryJumpBadgeProps) {
	const { index, count, onJump } = props
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [draft, setDraft] = useState("")
	useEffect(() => {
		if (open) setDraft(String(index + 1))
	}, [open, index])

	function commit() {
		const parsed = Number(draft)
		if (Number.isFinite(parsed)) {
			const next = Math.min(Math.max(Math.trunc(parsed), 1), count) - 1
			onJump(next)
		}
		setOpen(false)
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						aria-label={t("nav.jump")}
						data-testid="gallery-jump-badge"
						className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm text-white transition-colors hover:bg-black/80"
					>
						{index + 1} / {count}
					</button>
				}
			/>
			<PopoverContent side="top" className="flex w-40 items-center gap-2 p-2">
				<form
					onSubmit={(e) => {
						e.preventDefault()
						commit()
					}}
					className="flex w-full items-center gap-2"
				>
					<Input
						type="number"
						inputMode="numeric"
						min={1}
						max={count}
						value={draft}
						onChange={(e) => {
							setDraft(e.target.value)
						}}
						className="h-8 text-sm"
						data-testid="gallery-jump-input"
					/>
					<span className="text-xs text-muted-foreground">/ {count}</span>
				</form>
			</PopoverContent>
		</Popover>
	)
}
