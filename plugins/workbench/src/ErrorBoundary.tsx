import { Component, type ReactNode } from "react"

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
					<p className="text-ui font-medium">Workbench failed to start</p>
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
