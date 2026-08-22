import { Switch } from "@hoardodile/ui/components/switch"
import { useTranslation } from "../i18n"
import { FIT_MODES, type FitMode, type PlayerEngine } from "./types"

/** Fit-mode option label keys, typed so a new mode cannot go untranslated. */
export const FIT_LABEL: Readonly<Record<FitMode, string>> = {
	contain: "player.fitContain",
	natural: "player.fitNatural",
}

export function OptionGroup(props: {
	readonly label: string
	readonly children: React.ReactNode
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs text-muted-foreground">{props.label}</span>
			<div className="flex flex-wrap gap-1.5">{props.children}</div>
		</div>
	)
}

export function OptionPill(props: {
	readonly active: boolean
	readonly label: string
	readonly onClick: () => void
}) {
	const { active, label, onClick } = props
	return (
		<button
			type="button"
			onClick={onClick}
			data-active={active ? "true" : "false"}
			className="rounded-md border px-2.5 py-1 text-xs transition-colors data-[active=true]:border-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary hover:bg-accent"
		>
			{label}
		</button>
	)
}

export type DisplayOptionsProps = {
	readonly engine: PlayerEngine
	readonly fitMode: FitMode
	readonly autoplay: boolean
	readonly onEngineChange: (next: PlayerEngine) => void
	readonly onFitModeChange: (next: FitMode) => void
	readonly onAutoplayChange: (next: boolean) => void
}

/**
 * The autoplay / fit / engine rows shared by the display-settings
 * popover and the mobile "more" popover. One composition point so the
 * two surfaces cannot drift apart.
 */
export function DisplayOptions(props: DisplayOptionsProps) {
	const {
		engine,
		fitMode,
		autoplay,
		onEngineChange,
		onFitModeChange,
		onAutoplayChange,
	} = props
	const { t } = useTranslation()
	return (
		<>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-muted-foreground">
					{t("player.autoplay")}
				</span>
				<Switch
					checked={autoplay}
					onCheckedChange={onAutoplayChange}
					aria-label={t("player.autoplay")}
				/>
			</div>
			<OptionGroup label={t("player.fit")}>
				{FIT_MODES.map((m) => (
					<OptionPill
						key={m}
						active={fitMode === m}
						onClick={() => onFitModeChange(m)}
						label={t(FIT_LABEL[m])}
					/>
				))}
			</OptionGroup>
			<OptionGroup label={t("player.engine")}>
				<OptionPill
					active={engine === "enhanced"}
					onClick={() => onEngineChange("enhanced")}
					label={t("player.engineEnhanced")}
				/>
				<OptionPill
					active={engine === "native"}
					onClick={() => onEngineChange("native")}
					label={t("player.engineNative")}
				/>
			</OptionGroup>
		</>
	)
}
