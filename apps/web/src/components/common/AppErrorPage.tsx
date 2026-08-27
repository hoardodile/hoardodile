import { Button } from "@hoardodile/ui/components/button"
import { toast } from "@hoardodile/ui/components/toast"
import { DangerTriangle } from "@hoardodile/ui/icons/registry"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { openExternalUrl } from "@/components/common/ExternalLink"
import { DesktopCaptionBar } from "@/components/layout/DesktopCaptionBar"
import { getAppScrollContainer } from "@/features/doc/lib/docReadingAnchor"
import {
	APP_ISSUES_BUG_DESKTOP_URL,
	APP_ISSUES_BUG_SELFHOSTED_URL,
	APP_VERSION,
	bugIssueUrl,
} from "@/lib/appInfo"
import {
	flushClientLogToServer,
	formatDiagnostics,
	pushClientLog,
} from "@/lib/clientLog"
import { isHoardodileDesktop } from "@/lib/desktop"

type AppErrorPageProps = {
	/**
	 * The captured error. TanStack passes the thrown value; the top-level
	 * boundary passes its own state.
	 */
	readonly error?: unknown
	/** Clear the error boundary (TanStack's `reset`; optional at the top level). */
	readonly reset?: () => void
	/**
	 * Render the full-window frame (caption strip on desktop, viewport
	 * height) instead of the shell content block. The top-level boundary
	 * always sets it; the router's default error component detects a
	 * disappeared AppShell after commit.
	 */
	readonly standalone?: boolean
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		const name =
			error.name !== undefined && error.name.length > 0 ? `${error.name}: ` : ""
		return `${name}${error.message}`
	}
	return error === undefined ? "Unknown error" : String(error)
}

function errorStack(error: unknown): string | undefined {
	return error instanceof Error ? (error.stack ?? undefined) : undefined
}

/**
 * Designed replacement for TanStack Router's bare "Something went wrong!"
 * error component: one surface for render/loader crashes inside the SPA and
 * for errors thrown above the router (the top-level boundary in main.tsx).
 *
 * On desktop the Reload button re-loads the window (keeping the session —
 * equivalent to refreshing a browser tab); if the bundled server died too,
 * the shell's own `did-fail-load` error page with its Retry button takes
 * over. The error itself is recorded into the client log so Settings →
 * About → "Copy diagnostics" carries it into a report.
 */
export function AppErrorPage(props: AppErrorPageProps) {
	const { error, reset, standalone } = props
	const { t } = useTranslation()
	const [showDetails, setShowDetails] = useState(false)
	const [standaloneShell, setStandaloneShell] = useState(false)
	const [copying, setCopying] = useState(false)

	// After the boundary committed, the AppShell is missing exactly when a
	// root (shell-level) route crashed — then the window must keep its own
	// caption strip and viewport frame.
	useEffect(() => {
		if (standalone !== true) {
			setStandaloneShell(document.querySelector("[data-app-scroll]") === null)
		}
	}, [standalone])

	useEffect(() => {
		pushClientLog("error", errorMessage(error), errorStack(error))
		// Same-origin, best-effort: land the crash in the server's app.log
		// right away instead of waiting for the 15s sender interval.
		void flushClientLogToServer()
		getAppScrollContainer().scrollTo({ top: 0, behavior: "instant" })
	}, [error])

	async function handleCopy() {
		setCopying(true)
		try {
			await copyText(formatDiagnostics())
			toast.add({ title: t("appError.copied"), type: "success" })
		} catch {
			toast.add({ title: t("appError.copyFailed"), type: "error" })
		} finally {
			setCopying(false)
		}
	}

	const issueHref = isHoardodileDesktop()
		? APP_ISSUES_BUG_DESKTOP_URL
		: APP_ISSUES_BUG_SELFHOSTED_URL
	const stack = errorStack(error)

	const useFullFrame = standalone === true || standaloneShell

	const content = (
		<div className="flex min-h-full w-full items-center justify-center p-6">
			<div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
				<DangerTriangle
					className="size-10 text-destructive"
					strokeWidth={1.4}
					aria-hidden="true"
				/>
				<div className="flex flex-col gap-2">
					<h1 className="text-lg font-semibold text-foreground">
						{t("appError.title")}
					</h1>
					<p className="text-xs leading-5 text-muted-foreground">
						{t("appError.description")}
					</p>
				</div>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button
						data-testid="app-error-reload"
						className="[-webkit-app-region:no-drag]"
						onClick={() => {
							window.location.reload()
						}}
					>
						{t("appError.reload")}
					</Button>
					{reset !== undefined ? (
						<Button
							variant="secondary"
							data-testid="app-error-retry"
							onClick={reset}
						>
							{t("appError.tryAgain")}
						</Button>
					) : null}
					<Button
						variant="secondary"
						data-testid="app-error-copy"
						disabled={copying}
						onClick={() => {
							void handleCopy()
						}}
					>
						{t("appError.copyDetails")}
					</Button>
					<Button
						variant="outline"
						data-testid="app-error-report"
						onClick={() => {
							// Same report flow as Settings → About: open the
							// matching template with the version prefilled.
							openExternalUrl(bugIssueUrl(issueHref))
						}}
					>
						{t("appError.reportIssue")}
					</Button>
				</div>
				<div className="w-full">
					<button
						type="button"
						data-testid="app-error-details-toggle"
						onClick={() => setShowDetails((prev) => !prev)}
						className="text-tiny text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
					>
						{t("appError.details")}
					</button>
					{showDetails ? (
						<pre
							data-testid="app-error-details"
							className="mt-2 max-h-56 overflow-auto rounded-lg border border-border bg-muted/50 p-3 text-left text-[11px] leading-4 text-muted-foreground whitespace-pre-wrap"
						>
							{errorMessage(error)}
							{stack !== undefined ? (
								<>
									{"\n\n"}
									{stack}
								</>
							) : null}
						</pre>
					) : null}
				</div>
				<p className="text-tiny text-muted-foreground">
					hoardodile v{APP_VERSION}
				</p>
			</div>
		</div>
	)

	if (useFullFrame) {
		return (
			<div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
				{isHoardodileDesktop() ? <DesktopCaptionBar /> : null}
				<main className="flex min-h-0 flex-1">{content}</main>
			</div>
		)
	}
	return <div className="flex min-h-full flex-1">{content}</div>
}

/** Clipboard write with a textarea fallback for contexts without the API. */
export async function copyText(text: string): Promise<void> {
	if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
		await navigator.clipboard.writeText(text)
		return
	}
	const textarea = document.createElement("textarea")
	textarea.value = text
	textarea.style.position = "fixed"
	textarea.style.opacity = "0"
	textarea.setAttribute("aria-hidden", "true")
	document.body.appendChild(textarea)
	textarea.select()
	const ok = document.execCommand("copy")
	textarea.remove()
	if (!ok) throw new Error("clipboard write failed")
}
