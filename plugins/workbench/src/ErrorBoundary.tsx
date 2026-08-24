import { Component, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

/**
 * Error boundaries must stay class components (no hooks), so the
 * localized heading is rendered by a tiny function component.
 */
function BoundaryTitle(): ReactNode {
	const { t } = useTranslation("workbench")
	return <p className="text-ui font-medium">{t("app.failedTitle")}</p>
}

/**
 * Last-resort surface for a render-time crash. The workbench is a dev
 * tool: any failure is shown as a designed empty state instead of a
 * blank canvas (the pre-React page used to append a `<pre>` with the
 * stack to the stage).
 */
export class ErrorBoundary extends Component<
	{ readonly children: ReactNode },
	{ readonly error: unknown }
> {
	override state: { error: unknown } = { error: undefined }

	static getDerivedStateFromError(error: unknown): { error: unknown } {
		return { error }
	}

	override render(): ReactNode {
		const { error } = this.state
		if (error === undefined) return this.props.children
		return (
			<div className="flex h-full items-center justify-center p-8">
				<div className="flex max-w-md flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-card">
					<BoundaryTitle />
					<p className="text-xs text-muted-foreground">
						{error instanceof Error
							? (error.stack ?? error.message)
							: String(error)}
					</p>
				</div>
			</div>
		)
	}
}
