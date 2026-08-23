import type { HoardodileDesktopBridge } from "@hoardodile/shared/desktop"
import type { SupportedLanguage } from "@hoardodile/shared/i18n"
import { resolveSystemLanguage } from "@hoardodile/shared/i18n"
import { catalogFor } from "@hoardodile/shared/i18n/catalogs"
import { Button } from "@hoardodile/ui/components/button"
import { CaptionBar } from "@hoardodile/ui/components/caption-bar"
import {
	CloseConfirmDialog,
	type CloseConfirmDialogStrings,
} from "@hoardodile/ui/components/close-confirm-dialog"
import { useEffect, useState } from "react"
import { disabledCaptionHistory, shellCopy } from "./copy.ts"

export type ShellPageMode = "loading" | "error"

function closeDialogStrings(
	language: SupportedLanguage | undefined,
): CloseConfirmDialogStrings {
	const catalog = catalogFor(
		language ?? resolveSystemLanguage(navigator.language),
	)
	return {
		title: catalog.me.desktop.closeConfirm.title,
		description: catalog.me.desktop.closeConfirm.description,
		tray: catalog.me.desktop.closeConfirm.tray,
		quit: catalog.me.desktop.closeConfirm.quit,
		cancel: catalog.common.cancel,
		remember: catalog.me.desktop.closeConfirm.remember,
	}
}

/**
 * Shell pages (loading spinner / server unreachable + Retry) with the same
 * caption bar and close dialog as the SPA. Loaded from the wizard bundle in
 * the matching mode (`?mode=loading|error`); the close flow mirrors the
 * SPA caption: ask shows the shared close-confirm dialog, tray/quit run
 * directly. The dialog copy follows the language the SPA pushed (shared
 * catalogs), falling back to the shell's system language / English.
 */
export function ShellPages(props: {
	readonly mode: ShellPageMode
	readonly message?: string
}) {
	const desktop = window.hoardodileDesktop
	if (desktop === undefined) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-ui text-muted-foreground">
				{shellCopy().serverUnreachable}
			</div>
		)
	}
	return <ShellPagesView {...props} desktop={desktop} />
}

function ShellPagesView(props: {
	readonly mode: ShellPageMode
	readonly message?: string
	readonly desktop: HoardodileDesktopBridge
}) {
	const { mode, message, desktop } = props
	const copy = shellCopy()
	const [language, setLanguage] = useState<SupportedLanguage | undefined>(
		undefined,
	)
	const [strings, setStrings] = useState<CloseConfirmDialogStrings | undefined>(
		undefined,
	)
	const [askOpen, setAskOpen] = useState(false)
	const [retrying, setRetrying] = useState(false)

	const captionLabels = catalogFor(
		language ?? resolveSystemLanguage(navigator.language),
	).me.desktop.caption

	useEffect(() => {
		void desktop.getLanguage().then((resolved) => {
			setLanguage(resolved)
			setStrings(closeDialogStrings(resolved))
		})
	}, [desktop])

	function handleClose(): void {
		void desktop.getConfig().then((config) => {
			if (config.closeAction === "ask") {
				setAskOpen(true)
			} else {
				desktop.close()
			}
		})
	}

	function handleRetry(): void {
		setRetrying(true)
		desktop.retryLoad()
	}

	function handleDecide(action: "tray" | "quit", remember: boolean): void {
		setAskOpen(false)
		void desktop.closeWithAction(action, remember)
	}

	return (
		<div className="flex h-full flex-col bg-background">
			<CaptionBar
				controls={{ ...desktop, close: handleClose }}
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
			<main className="flex min-h-0 flex-1 items-center justify-center p-6">
				{mode === "loading" ? (
					<div
						role="progressbar"
						aria-label={copy.loadingLabel}
						className="size-[26px] animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
					/>
				) : (
					<div className="flex max-w-[460px] flex-col items-center gap-3 text-center">
						<h1 className="text-[17px] font-semibold text-foreground">
							{copy.serverUnreachable}
						</h1>
						<p className="text-[13px] leading-7 text-muted-foreground">
							{message}
						</p>
						<Button className="mt-2" disabled={retrying} onClick={handleRetry}>
							{copy.retry}
						</Button>
					</div>
				)}
			</main>
			{strings !== undefined ? (
				<CloseConfirmDialog
					open={askOpen}
					onOpenChange={setAskOpen}
					onDecide={handleDecide}
					strings={strings}
				/>
			) : null}
		</div>
	)
}
