import type { HoardodileDesktopBridge } from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { CaptionBar } from "@hoardodile/ui/components/caption-bar"
import { CloseConfirmDialog } from "@hoardodile/ui/components/close-confirm-dialog"
import { useEffect, useState } from "react"
import logoUrl from "../../resources/icon.png?inline"
import { disabledCaptionHistory, shellCopy } from "./copy.ts"
import { applyLanguage } from "./i18n.ts"

export type ShellPageMode = "loading" | "error"

/**
 * Shell pages (loading logo / server unreachable + Retry) from the wizard
 * bundle in the matching mode (`?mode=loading|error`). The loading mode is
 * a transient state: no caption bar (it would pop in and out during the
 * shell → SPA handoff), just the same dimmed logo the SPA splash shows, so
 * both loading surfaces read as one. The error mode keeps the caption bar
 * and close dialog — a stuck server must stay closable — with the same
 * close flow as the SPA caption: ask shows the shared close-confirm
 * dialog, tray/quit run directly. Caption/dialog copy follows the shared
 * `ui` catalog namespace (instance in `./i18n.ts`); the language follows
 * the SPA push (shared catalogs), falling back to the shell's system
 * language.
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
	const [askOpen, setAskOpen] = useState(false)
	const [retrying, setRetrying] = useState(false)

	useEffect(() => {
		void desktop.getLanguage().then(applyLanguage)
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
			{mode === "error" ? (
				<CaptionBar
					controls={{ ...desktop, close: handleClose }}
					history={disabledCaptionHistory}
				/>
			) : null}
			<main className="flex min-h-0 flex-1 items-center justify-center p-6">
				{mode === "loading" ? (
					<div role="progressbar" aria-label={copy.loadingLabel}>
						<img
							src={logoUrl}
							width={80}
							height={80}
							alt=""
							className="size-20 opacity-60"
							decoding="async"
						/>
					</div>
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
			{mode === "error" ? (
				<CloseConfirmDialog
					open={askOpen}
					onOpenChange={setAskOpen}
					onDecide={handleDecide}
				/>
			) : null}
		</div>
	)
}
