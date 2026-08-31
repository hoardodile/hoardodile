import { useTranslation } from "react-i18next"
import type { WorkbenchPresentationMode } from "../config.ts"
import type { WorkbenchManifest } from "../context.ts"

/**
 * The workbench status bar (bottom): the mounted plugin label and the
 * current presentation mode. Text-only; the hook snapshot detail lives in
 * the plugin-info dialog.
 */
export function StatusBar(props: {
	readonly manifest: WorkbenchManifest | null
	readonly mode: WorkbenchPresentationMode
}) {
	const { manifest, mode } = props
	const { t: tw } = useTranslation("workbench")

	return (
		<footer className="flex h-8 shrink-0 items-center gap-3 border-t border-border px-4 text-xs text-muted-foreground">
			<span
				id="plugin-name"
				className="min-w-0 truncate text-ui text-secondary-foreground"
			>
				{manifest === null ? "…" : `${manifest.name} (${manifest.id})`}
			</span>
			<span className="shrink-0">{tw(`mode.${mode}`)}</span>
			<span className="min-w-0 flex-1" />
		</footer>
	)
}
