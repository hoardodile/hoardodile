import type { Danmaku as DanmakuRecord } from "@hoardodile/sdk-web"
import { toast } from "@hoardodile/ui/components/toast"
import { usePluginAPI } from "../hooks"
import { useTranslation } from "../i18n"

type SubmitterDeps = {
	readonly filename: string
	readonly getCurrentMs: () => number
	readonly onEmit?: (created: DanmakuRecord) => void
}

type SubmitterAPI = {
	readonly submit: (text: string) => void
	readonly isPending: boolean
}

export function useDanmakuSubmitter(deps: SubmitterDeps): SubmitterAPI {
	const api = usePluginAPI()
	const { filename, getCurrentMs, onEmit } = deps
	const { t } = useTranslation()
	const { mutate: createDanmaku, isPending } = api.useCreateDanmaku()

	function submit(text: string) {
		const trimmed = text.trim()
		if (trimmed.length === 0 || isPending) return
		const rawMs = getCurrentMs()
		const timeMs = Number.isFinite(rawMs) ? Math.max(0, Math.round(rawMs)) : 0
		createDanmaku({
			text: trimmed,
			anchor: { kind: "videoTime", filename, timeMs },
			mode: "scroll",
		})
			.then((created) => {
				onEmit?.(created)
				return api.invalidate("danmaku")
			})
			.catch((err: Error) => {
				toast.add({
					title: err.message || t("player.danmakuSendFailed"),
					type: "error",
				})
			})
	}

	return { submit, isPending }
}
