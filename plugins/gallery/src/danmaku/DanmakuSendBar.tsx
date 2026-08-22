import { MAX_DANMAKU_TEXT_LENGTH } from "@hoardodile/sdk-types/text-limits"

import type { Danmaku as DanmakuRecord } from "@hoardodile/sdk-web"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { cn } from "@hoardodile/ui/lib/utils"
import { PlaneIcon as Plain } from "@solar-icons/react/linear/plane"
import { useState } from "react"
import { useTranslation } from "../i18n"
import { DanmakuSettingsPopover } from "./DanmakuSettingsPopover"
import type { DanmakuSettings } from "./types"
import { useDanmakuSubmitter } from "./useDanmakuSubmitter"

type SendBarProps = {
	readonly filename: string
	readonly getCurrentMs: () => number
	readonly onEmit: (d: DanmakuRecord) => void
	readonly settings: DanmakuSettings
	readonly onSettingsChange: (next: DanmakuSettings) => void
}

export function DanmakuSendBar(props: SendBarProps) {
	const { filename, getCurrentMs, onEmit, settings, onSettingsChange } = props
	const { t } = useTranslation()
	const [text, setText] = useState("")
	const { submit, isPending } = useDanmakuSubmitter({
		filename,
		getCurrentMs,
		onEmit: (created) => {
			onEmit(created)
			setText("")
		},
	})
	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		submit(text)
	}
	const canSubmit = text.trim().length > 0 && !isPending
	return (
		<form
			className="flex items-center gap-2 bg-black px-4 py-2 text-white outline-hidden focus:outline-hidden focus-visible:outline-hidden"
			tabIndex={-1}
			onSubmit={handleSubmit}
		>
			<DanmakuSettingsPopover settings={settings} onChange={onSettingsChange} />
			<Input
				value={text}
				onChange={(e) => {
					setText(e.target.value)
				}}
				placeholder={t("player.sendDanmakuPlaceholder")}
				maxLength={MAX_DANMAKU_TEXT_LENGTH}
				className={cn(
					"h-8 rounded-md border border-white/15 px-3 text-sm shadow-none transition-colors",
					// Always light text on the dark transparent surface so
					// it stays readable in both light and dark themes (the
					// surrounding form is always `bg-black`). The previous
					// `focus-visible:bg-white focus-visible:text-black`
					// rule swapped the colours on focus, which produced
					// black-on-black for a moment in dark mode while the
					// browser repainted the white background.
					"bg-white/5 text-white placeholder:text-white/40 caret-white",
					"focus-visible:bg-white/10 focus-visible:text-white",
					"focus-visible:border-white/40 focus-visible:ring-0",
				)}
			/>
			<Button
				type="submit"
				size="sm"
				disabled={!canSubmit}
				className="h-8 gap-1 rounded-md px-4"
			>
				<Plain className="size-3.5" />
				{t("player.sendDanmaku")}
			</Button>
		</form>
	)
}
