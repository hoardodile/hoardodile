import type { HoardodileDesktopBridge } from "@hoardodile/shared/desktop"
import en from "@hoardodile/shared/i18n/en.json"
import zh from "@hoardodile/shared/i18n/zh.json"
import { Button } from "@hoardodile/ui/components/button"
import { CaptionBar } from "@hoardodile/ui/components/caption-bar"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { Switch } from "@hoardodile/ui/components/switch"
import { useEffect, useState } from "react"
import { disabledCaptionHistory, type WizardCopy, wizardCopy } from "./copy.ts"

export function WizardApp() {
	const copy = wizardCopy()
	const desktop = window.hoardodileDesktop
	if (desktop === undefined) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-ui text-muted-foreground">
				{copy.missingBridge}
			</div>
		)
	}
	return <WizardForm copy={copy} desktop={desktop} />
}

function WizardForm(props: {
	readonly copy: WizardCopy
	readonly desktop: HoardodileDesktopBridge
}) {
	const { copy, desktop } = props
	const [libraryPath, setLibraryPath] = useState("")
	const [autoStart, setAutoStart] = useState(false)
	const [startInTray, setStartInTray] = useState(false)
	const [busy, setBusy] = useState(false)
	const [language, setLanguage] = useState<string | undefined>(undefined)

	useEffect(() => {
		void desktop.getWizardDefaults().then((defaults) => {
			setLibraryPath(defaults.libraryPath)
		})
		void desktop.getLanguage().then(setLanguage)
	}, [desktop])

	const captionLabels = (language === "zh" ? zh : en).me.desktop.caption

	async function handleBrowse(): Promise<void> {
		const next = await desktop.pickLibraryFolder()
		if (next !== undefined) setLibraryPath(next)
	}

	async function handleContinue(): Promise<void> {
		if (libraryPath.length === 0) return
		setBusy(true)
		try {
			await desktop.completeWizard({
				libraryPath,
				autoStart,
				startInTray,
			})
		} finally {
			setBusy(false)
		}
	}

	return (
		<div className="flex h-full flex-col bg-background">
			<CaptionBar
				controls={desktop}
				history={disabledCaptionHistory}
				labels={{
					back: captionLabels.back,
					forward: captionLabels.forward,
					reload: captionLabels.reload,
					minimize: captionLabels.minimize,
					maximize: captionLabels.maximize,
					restore: captionLabels.restore,
					close: captionLabels.close,
					devtools: captionLabels.devtools,
				}}
			/>
			<main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-8">
				<div>
					<h1 className="text-xl font-semibold text-foreground">
						{copy.title}
					</h1>
					<p className="mt-2 text-xs leading-5 text-muted-foreground">
						{copy.intro}
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="library-path">{copy.library}</Label>
					<div className="flex gap-2">
						<Input
							id="library-path"
							value={libraryPath}
							readOnly
							className="[-webkit-app-region:no-drag]"
						/>
						<Button
							variant="secondary"
							className="shrink-0 [-webkit-app-region:no-drag]"
							onClick={() => {
								void handleBrowse()
							}}
						>
							{copy.browse}
						</Button>
					</div>
				</div>
				<div className="flex items-center justify-between gap-4 [-webkit-app-region:no-drag]">
					<span>
						<span className="block text-ui font-semibold text-foreground">
							{copy.autoStart}
						</span>
						<span className="mt-0.5 block text-xs text-muted-foreground">
							{copy.autoStartHint}
						</span>
					</span>
					<Switch
						checked={autoStart}
						onCheckedChange={setAutoStart}
						aria-label={copy.autoStart}
					/>
				</div>
				<div className="flex items-center justify-between gap-4 [-webkit-app-region:no-drag]">
					<span>
						<span className="block text-ui font-semibold text-foreground">
							{copy.startInTray}
						</span>
						<span className="mt-0.5 block text-xs text-muted-foreground">
							{copy.startInTrayHint}
						</span>
					</span>
					<Switch
						checked={startInTray}
						onCheckedChange={setStartInTray}
						aria-label={copy.startInTray}
					/>
				</div>
				<div className="mt-auto flex justify-end">
					<Button
						className="[-webkit-app-region:no-drag]"
						disabled={busy || libraryPath.length === 0}
						onClick={() => {
							void handleContinue()
						}}
					>
						{copy.continue}
					</Button>
				</div>
			</main>
		</div>
	)
}
