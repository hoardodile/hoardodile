import { Button } from "@hoardodile/ui/components/button"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

/**
 * Friendly full-panel state for a document page whose document no longer
 * exists — hard-deleted, or reached through a stale link / "last opened"
 * preference. Replaces the route's default error boundary: the page
 * stays inside the shell with a clear way back instead of an error.
 */
export function DocNotFound() {
	const { t } = useTranslation()
	return (
		<div className="flex h-full min-h-[50svh] flex-col items-center justify-center gap-4 p-8 text-center">
			<div className="flex flex-col gap-1.5">
				<p className="text-lg font-semibold tracking-wide">
					{t("documents.notFound.title")}
				</p>
				<p className="text-sm text-muted-foreground">
					{t("documents.notFound.description")}
				</p>
			</div>
			<Button variant="outline" render={<Link to="/documents" />}>
				{t("documents.notFound.back")}
			</Button>
		</div>
	)
}
